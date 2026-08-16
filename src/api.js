// Local-first API facade. The interface is unchanged from before, so App.jsx /
// Study.jsx / SongView.jsx keep calling `api.*` as-is. What changed underneath:
// data lives on-device in IndexedDB (src/store.js) and works offline; only the
// AI analysis and key management talk to the thin server.
import * as store from './store.js';
import { MODELS, PROVIDER_LABELS } from './models.js';

// In dev, '' uses the Vite proxy (/api -> :3001). In production the static app
// and the server are different origins, so set VITE_API_BASE at build time.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

const APP_PW_KEY = 'japp.appPassword';
function appPassword() {
  try {
    return localStorage.getItem(APP_PW_KEY) ?? '';
  } catch {
    return '';
  }
}

// The user's identifier for the per-user library backup. Stored on-device like
// the app password; until real auth exists it's just an ID the user picks.
const USER_ID_KEY = 'japp.userId';
function getUserId() {
  try {
    return localStorage.getItem(USER_ID_KEY) ?? '';
  } catch {
    return '';
  }
}
function setUserId(id) {
  try {
    localStorage.setItem(USER_ID_KEY, id);
  } catch {
    // ignore
  }
}

// Calls the thin server. These are the only operations that require internet.
// Carries the app password (if set) so the server's gate lets them through.
async function serverRequest(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const pw = appPassword();
  if (pw) headers['X-App-Password'] = pw;

  // Abort after 8 seconds so a sleeping server never blocks the app.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let res;
  try {


    res = await fetch(API_BASE + path, { ...options, headers, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The server is not responding. Please try again in a moment.');
    throw new Error('You appear to be offline. Connect to the internet to analyze songs or update keys.');
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const err = new Error(body.error ?? 'Incorrect app password.');
    err.code = 401;
    throw err;
  }
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

// App-password gate (Option B). Enforcement is server-side; this just lets the
// UI discover whether a gate exists and store/verify the password per device.
export const auth = {
  hasPassword: () => Boolean(appPassword()),
  getUserId: () => getUserId(),
  setUserId: (id) => setUserId(id),
  hasUserId: () => Boolean(getUserId()),
  clear: () => {
    try {
      localStorage.removeItem(APP_PW_KEY);
      localStorage.removeItem(USER_ID_KEY);
    } catch {
      // ignore
    }
  },
  // Does the server require a password? { required } online, { offline:true } if
  // unreachable (we then let the app load — its data is local and the API stays
  // server-enforced regardless).
  status: async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(API_BASE + '/api/auth', { signal: controller.signal });
      if (res.status === 401) return { required: true };
      const body = await res.json().catch(() => ({}));
      return { required: Boolean(body.required) };
    } catch {
      return { offline: true };
    } finally {
      clearTimeout(timer);
    }
  },
  // Verify a candidate password against the server; store it on success.
  signIn: async (password) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let res;
    try {
      res = await fetch(API_BASE + '/api/auth', { headers: { 'X-App-Password': password }, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The server is not responding. Please try again in a moment.');
      throw new Error('Could not reach the server. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      try {
        localStorage.setItem(APP_PW_KEY, password);
      } catch {
        // ignore storage failures
      }
      return true;
    }
    if (res.status === 401) throw new Error('Incorrect password.');
    throw new Error(`Could not verify password (${res.status}).`);
  },
};

const KEYMETA_CACHE = 'japp.keymeta';
const EMPTY_KEYS = { deepseek: { set: false, source: null, hint: null } };

// ---- per-user library backup (Turso) --------------------------------------
// The on-device IndexedDB is the working copy; the server keeps a reference-
// level backup (song fingerprints + saved/learnt words) so a redeploy can't
// lose a user's data. syncLibrary() runs on boot, schedulePush() after changes.

// The in-flight boot restore. Every push waits for it so a fresh device never
// overwrites its backup with empty state before the restore finishes.
let syncPromise = Promise.resolve();
let pushTimer = null;

// Uploads the full local library snapshot for the given user.
async function pushSnapshot(userId) {
  const [songKeys, saved, learnt] = await Promise.all([
    store.songKeys(),
    store.getSaved(),
    store.getLearnt(),
  ]);
  await serverRequest('/api/user/library', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, songKeys, saved, learnt }),
  });
}

// Debounced push: batches bursts of changes (starring several words, adding a
// song…) into one snapshot upload. Offline failures are skipped — the next
// change (or next boot's sync) re-syncs.
function schedulePush() {
  const userId = getUserId();
  if (!userId) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    await syncPromise;
    const uid = getUserId();
    if (!uid) return;
    try {
      await pushSnapshot(uid);
    } catch {
      // offline — the backup catches up on the next change or boot
    }
  }, 400);
}

// Returns the last-known key status instantly (cache-first, no network wait).
// Refreshes in the background so the Config screen is up-to-date next time.
function keyMeta() {
  // Read cache synchronously (localStorage is sync). Fall back to EMPTY_KEYS.
  let cached;
  try {
    cached = JSON.parse(localStorage.getItem(KEYMETA_CACHE)) ?? EMPTY_KEYS;
  } catch {
    cached = EMPTY_KEYS;
  }

  // Refresh in the background — never block the caller.
  serverRequest('/api/keymeta')
    .then((meta) => localStorage.setItem(KEYMETA_CACHE, JSON.stringify(meta)))
    .catch(() => {});

  return cached;
}

export const api = {
  // --- settings (model is local; key status comes from the server when online) ---
  getSettings: async () => ({
    model: await store.getModel(),
    models: MODELS,
    providerLabels: PROVIDER_LABELS,
    keys: await keyMeta(),
  }),
  saveSettings: async ({ model }) => ({ model: await store.setModel(model) }),
  saveKey: (provider, key) =>
    serverRequest('/api/keys', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    }),

  // --- words / vocab (offline) ---
  allVocab: () => store.allVocab(),
  getLearnt: () => store.getLearnt(),
  addLearnt: (word) => store.addLearnt(word),
  removeLearnt: (word) => store.removeLearnt(word),
  getSaved: () => store.getSaved(),
  myWords: () => store.myWords(),
  addSaved: (word) => store.addSaved(word),
  removeSaved: (word) => store.removeSaved(word),

  // --- songs (offline) ---
  listSongs: () => store.listSongs(),
  getSong: (id) => store.getSong(id),
  deleteSong: (id) => store.deleteSong(id),

  // --- per-user library backup (Turso) ---
  // Reads the user's saved reference list from the server.
  getLibrary: (userId) =>
    serverRequest(`/api/user/library?userId=${encodeURIComponent(userId)}`),

  // Fetches full cached analyses for the given song keys, so a fresh install
  // can rebuild its library from the backup without re-running the AI.
  getSongsByKeys: (keys) =>
    serverRequest('/api/user/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    }),

  // Reconciles the on-device library with the user's server backup. On a
  // fresh device (empty local store) it restores from the backup; otherwise
  // it pushes the current local state up. Runs once at boot, after login.
  syncLibrary: async () => {
    const userId = getUserId();
    const run = (async () => {
      if (!userId) return;
      let remote;
      try {
        remote = await serverRequest(`/api/user/library?userId=${encodeURIComponent(userId)}`);
      } catch {
        return; // offline — keep the on-device library as-is
      }
      const [localSongs, localSaved, localLearnt] = await Promise.all([
        store.listSongs(),
        store.getSaved(),
        store.getLearnt(),
      ]);
      const localEmpty = localSongs.length === 0 && localSaved.length === 0 && localLearnt.length === 0;
      const remoteEmpty =
        !remote.songKeys?.length && !remote.saved?.length && !remote.learnt?.length;

      if (localEmpty && !remoteEmpty) {
        // Fresh device: rebuild the library from the backup.
        try {
          const { songs } = await serverRequest('/api/user/songs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: remote.songKeys ?? [] }),
          });
          if (songs?.length) await store.restoreSongs(songs);
        } catch {
          // Couldn't fetch analyses — still restore the word lists below.
        }
        await store.setSaved(remote.saved ?? []);
        await store.setLearnt(remote.learnt ?? []);
      } else if (!localEmpty || !remoteEmpty) {
        // Push the (merged/current) local state up so the backup stays fresh.
        await pushSnapshot(userId);
      }
    })();
    syncPromise = run;
    return run;
  },

  // Debounced push of the current library snapshot after any change.
  schedulePush: schedulePush,

  // --- analyze: cache hit is offline; a miss needs the AI server ---
  analyze: async ({ lyrics, title, artist }) => {
    const text = (lyrics ?? '').trim();
    const lyricsKey = text ? await store.fingerprint(text) : undefined;

    const existing = await store.findExisting({ title, artist, lyricsKey });
    if (existing) return { ...(await store.getSong(existing.id)), cached: true };

    const model = await store.getModel();
    const analysis = await serverRequest('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lyrics: text, title, artist, model }),
    });

    const key = lyricsKey ?? (await store.fingerprint((analysis.lines ?? []).map((l) => l.kanji).join('\n') || text || `${title} ${artist}`));
    const query = title?.trim() ? { title: title.trim(), artist: artist?.trim() || undefined } : undefined;
    return store.addSong(analysis, { query, lyricsKey: key, model });
  },
};
