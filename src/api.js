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

// Calls the thin server. These are the only operations that require internet.
// Carries the app password (if set) so the server's gate lets them through.
async function serverRequest(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const pw = appPassword();
  if (pw) headers['X-App-Password'] = pw;
  let res;
  try {
    res = await fetch(API_BASE + path, { ...options, headers });
  } catch {
    throw new Error('You appear to be offline. Connect to the internet to analyze songs or update keys.');
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
  hasStored: () => Boolean(appPassword()),
  clear: () => {
    try {
      localStorage.removeItem(APP_PW_KEY);
    } catch {
      // ignore
    }
  },
  // Does the server require a password? { required } online, { offline:true } if
  // unreachable (we then let the app load — its data is local and the API stays
  // server-enforced regardless).
  status: async () => {
    try {
      const res = await fetch(API_BASE + '/api/auth');
      if (res.status === 401) return { required: true };
      const body = await res.json().catch(() => ({}));
      return { required: Boolean(body.required) };
    } catch {
      return { offline: true };
    }
  },
  // Verify a candidate password against the server; store it on success.
  signIn: async (password) => {
    let res;
    try {
      res = await fetch(API_BASE + '/api/auth', { headers: { 'X-App-Password': password } });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
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
const EMPTY_KEYS = { deepseek: { set: false, source: null, hint: null }, perplexity: { set: false, source: null, hint: null } };

async function keyMeta() {
  try {
    const meta = await serverRequest('/api/keymeta');
    localStorage.setItem(KEYMETA_CACHE, JSON.stringify(meta));
    return meta;
  } catch {
    // Offline: fall back to the last-known status so the Config screen still renders.
    try {
      return JSON.parse(localStorage.getItem(KEYMETA_CACHE)) ?? EMPTY_KEYS;
    } catch {
      return EMPTY_KEYS;
    }
  }
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
