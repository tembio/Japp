// Local-first API facade. The interface is unchanged from before, so App.jsx /
// Study.jsx / SongView.jsx keep calling `api.*` as-is. What changed underneath:
// data lives on-device in IndexedDB (src/store.js) and works offline; only the
// AI analysis and key management talk to the thin server.
import * as store from './store.js';
import { MODELS, PROVIDER_LABELS } from './models.js';

// In dev, '' uses the Vite proxy (/api -> :3001). In production the static app
// and the server are different origins, so set VITE_API_BASE at build time.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

// Calls the thin server. These are the only operations that require internet.
async function serverRequest(path, options) {
  let res;
  try {
    res = await fetch(API_BASE + path, options);
  } catch {
    throw new Error('You appear to be offline. Connect to the internet to analyze songs or update keys.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const KEYMETA_CACHE = 'japp.keymeta';
const EMPTY_KEYS = { gemini: { set: false, source: null, hint: null }, deepseek: { set: false, source: null, hint: null } };

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
