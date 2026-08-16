// On-device data layer (IndexedDB). This is a browser port of server/store.js:
// the library, saved/learnt words and the selected model all live here so the
// app works fully offline. Only analyzing a new song needs the network.
import { openDB } from 'idb';
import { DEFAULT_MODEL } from './models.js';

const DB_NAME = 'japp';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('songs')) {
      db.createObjectStore('songs', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('kv')) {
      // simple key/value store: 'saved' -> string[], 'learnt' -> string[],
      // 'model' -> string, 'seeded' -> boolean
      db.createObjectStore('kv');
    }
  },
});

async function allSongs() {
  return (await dbPromise).getAll('songs');
}

async function kvGet(key, fallback) {
  const v = await (await dbPromise).get('kv', key);
  return v === undefined ? fallback : v;
}

async function kvSet(key, value) {
  await (await dbPromise).put('kv', value, key);
  return value;
}

// ---- text helpers (mirrors server/store.js) -------------------------------

function normalize(text) {
  return (text ?? '').trim().replace(/\s+/g, '');
}

function normalizeLoose(text) {
  return normalize(text).toLowerCase();
}

// Models sometimes return "Unknown" instead of the empty string the schema asks for.
function cleanArtist(artist) {
  const a = (artist ?? '').trim();
  return /^(unknown( artist)?|不明|n\/a|none)$/i.test(a) ? '' : a;
}

// SHA-256 of the whitespace-stripped lyrics, used to detect a re-analysis of
// the same song. Browser equivalent of the Node crypto hash in server/index.js.
export async function fingerprint(text) {
  const normalized = text.replace(/\s+/g, '').toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- saved / learnt -------------------------------------------------------

export async function getSaved() {
  return kvGet('saved', []);
}

export async function addSaved(word) {
  const set = new Set(await getSaved());
  set.add(normalize(word));
  await kvSet('saved', [...set]);
  // Re-saving a word cancels its tombstone so the backup keeps it.
  await removeRemovedSaved(normalize(word));
  return [...set];
}

export async function removeSaved(word) {
  const w = normalize(word);
  const next = (await getSaved()).filter((x) => x !== w);
  await kvSet('saved', next);
  // Record the removal as a tombstone so the backup drops it too.
  await addRemovedSaved(w);
  return next;
}

export async function getLearnt() {
  return kvGet('learnt', []);
}

export async function addLearnt(word) {
  const set = new Set(await getLearnt());
  set.add(normalize(word));
  await kvSet('learnt', [...set]);
  await removeRemovedLearnt(normalize(word));
  return [...set];
}

export async function removeLearnt(word) {
  const w = normalize(word);
  const next = (await getLearnt()).filter((x) => x !== w);
  await kvSet('learnt', next);
  await addRemovedLearnt(w);
  return next;
}

// ---- removed-word tombstones ----------------------------------------------
// Words the user explicitly un-saved / un-learnt, so a restore doesn't bring
// them back. Mirrors the server's removed_saved / removed_learnt columns.

export async function getRemovedSaved() {
  return kvGet('removedSaved', []);
}

export async function addRemovedSaved(word) {
  const set = new Set(await getRemovedSaved());
  set.add(normalize(word));
  return kvSet('removedSaved', [...set]);
}

export async function removeRemovedSaved(word) {
  const next = (await getRemovedSaved()).filter((w) => w !== normalize(word));
  return kvSet('removedSaved', next);
}

export async function setRemovedSaved(words) {
  return kvSet('removedSaved', [...new Set((words ?? []).map(normalize))]);
}

export async function getRemovedLearnt() {
  return kvGet('removedLearnt', []);
}

export async function addRemovedLearnt(word) {
  const set = new Set(await getRemovedLearnt());
  set.add(normalize(word));
  return kvSet('removedLearnt', [...set]);
}

export async function removeRemovedLearnt(word) {
  const next = (await getRemovedLearnt()).filter((w) => w !== normalize(word));
  return kvSet('removedLearnt', next);
}

export async function setRemovedLearnt(words) {
  return kvSet('removedLearnt', [...new Set((words ?? []).map(normalize))]);
}

// ---- settings -------------------------------------------------------------

export async function getModel() {
  return kvGet('model', DEFAULT_MODEL);
}

export async function setModel(model) {
  return kvSet('model', model);
}

// ---- songs ----------------------------------------------------------------

export async function listSongs() {
  const songs = await allSongs();
  return songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    addedAt: s.addedAt,
    vocabCount: s.vocabulary.length,
    grammarCount: s.grammar.length,
  }));
}

export async function getSong(id) {
  const songs = await allSongs();
  const song = songs.find((s) => s.id === id);
  if (!song) return null;
  return withLiveSeenIn(song, songs);
}

// seenIn is recomputed from the current library on every read, so references
// stay clickable ({id, title, artist}) and never point at deleted songs.
function withLiveSeenIn(song, songs) {
  const vocabIndex = new Map();
  const grammarIndex = new Map();
  for (const s of songs) {
    if (s.id === song.id) continue;
    const ref = { id: s.id, title: s.title, artist: s.artist };
    for (const v of s.vocabulary) push(vocabIndex, normalize(v.word), ref);
    for (const g of s.grammar) push(grammarIndex, normalize(g.pattern), ref);
  }
  return {
    ...song,
    vocabulary: song.vocabulary.map((v) => ({
      ...v,
      seenIn: vocabIndex.get(normalize(v.word)) ?? [],
    })),
    grammar: song.grammar.map((g) => ({
      ...g,
      seenIn: grammarIndex.get(normalize(g.pattern)) ?? [],
    })),
  };
}

function push(map, key, ref) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(ref);
}

export async function deleteSong(id) {
  const db = await dbPromise;
  const songs = await allSongs();
  const song = songs.find((s) => s.id === id);
  await db.delete('songs', id);
  return song?.lyricsKey ?? null;
}

// ---- deleted song tombstones ----------------------------------------------
// Fingerprints of songs the user explicitly deleted. Sent to the backup so a
// restore doesn't bring deleted songs back, while the backup itself is add-only.

export async function getDeleted() {
  return kvGet('deleted', []);
}

export async function addDeleted(key) {
  const set = new Set(await getDeleted());
  set.add(normalize(key));
  return kvSet('deleted', [...set]);
}

export async function setDeleted(keys) {
  return kvSet('deleted', [...new Set((keys ?? []).map(normalize))]);
}

// The lyric fingerprints (lyricsKey) of every song in the library. This is the
// per-user backup payload — the songs themselves live in the Turso cache.
export async function songKeys() {
  const songs = await allSongs();
  return songs.map((s) => s.lyricsKey).filter(Boolean);
}

// Rebuilds songs from cached analyses fetched from the per-user backup. Each
// item is { key: lyricsKey, analysis: <full analysis> }. Fresh ids/addedAt are
// assigned; songs already present (by lyricsKey) are skipped, so a restore
// never duplicates or clobbers on-device data.
export async function restoreSongs(items) {
  const db = await dbPromise;
  const existingKeys = new Set((await allSongs()).map((s) => s.lyricsKey).filter(Boolean));
  const fresh = [];
  for (const { key, analysis } of items ?? []) {
    if (!key || !analysis || existingKeys.has(key)) continue;
    fresh.push({
      id: crypto.randomUUID(),
      addedAt: new Date().toISOString(),
      lyricsKey: key,
      ...analysis,
      artist: cleanArtist(analysis.artist),
    });
  }
  if (fresh.length) {
    const tx = db.transaction('songs', 'readwrite');
    for (const s of fresh) tx.store.put(s);
    await tx.done;
  }
  return fresh.length;
}

// Replaces the saved/learnt lists outright (used when restoring a backup onto a
// fresh device).
export async function setSaved(words) {
  return kvSet('saved', [...new Set((words ?? []).map(normalize))]);
}

export async function setLearnt(words) {
  return kvSet('learnt', [...new Set((words ?? []).map(normalize))]);
}

// Returns a previously saved song matching the search query (title/artist,
// also checked against what the user originally typed) or pasted lyrics.
export async function findExisting({ title, artist, lyricsKey }) {
  const t = normalizeLoose(title);
  const a = normalizeLoose(artist);
  const songs = await allSongs();
  return (
    songs.find((s) => {
      if (lyricsKey && s.lyricsKey === lyricsKey) return true;
      if (!t) return false;
      const titleMatch = normalizeLoose(s.title) === t || normalizeLoose(s.query?.title) === t;
      if (!titleMatch) return false;
      if (!a) return true;
      return normalizeLoose(s.artist) === a || normalizeLoose(s.query?.artist) === a;
    }) ?? null
  );
}

// Marks each vocab word / grammar pattern with the earlier songs it already
// appeared in, then persists the new song.
export async function addSong(analysis, { query, lyricsKey, model } = {}) {
  const songs = await allSongs();
  const vocabIndex = new Map();
  const grammarIndex = new Map();
  for (const s of songs) {
    const ref = { id: s.id, title: s.title, artist: s.artist };
    for (const v of s.vocabulary) push(vocabIndex, normalize(v.word), ref);
    for (const g of s.grammar) push(grammarIndex, normalize(g.pattern), ref);
  }

  const song = {
    id: crypto.randomUUID(),
    addedAt: new Date().toISOString(),
    query,
    lyricsKey,
    model,
    ...analysis,
    artist: cleanArtist(analysis.artist),
    vocabulary: analysis.vocabulary.map((v) => ({
      ...v,
      seenIn: vocabIndex.get(normalize(v.word)) ?? [],
    })),
    grammar: analysis.grammar.map((g) => ({
      ...g,
      seenIn: grammarIndex.get(normalize(g.pattern)) ?? [],
    })),
  };

  await (await dbPromise).put('songs', song);
  return song;
}

// ---- derived views (My words / flashcards) --------------------------------

// "My words" = every word the user has engaged with (saved or learnt),
// enriched with details, the songs it appears in, and its saved/learnt flags.
export async function myWords() {
  const songs = await allSongs();
  const savedSet = new Set(await getSaved());
  const learntSet = new Set(await getLearnt());
  const keys = new Set([...savedSet, ...learntSet]);
  return [...keys]
    .map((key) => ({
      ...wordDetail(songs, key),
      saved: savedSet.has(key),
      learnt: learntSet.has(key),
    }))
    .sort((a, b) => a.word.localeCompare(b.word, 'ja'));
}

function wordDetail(songs, key) {
  let entry = null;
  const inSongs = [];
  for (const s of songs) {
    const v = s.vocabulary.find((vv) => normalize(vv.word) === key);
    if (v) {
      entry ??= v;
      inSongs.push({ id: s.id, title: s.title, artist: s.artist });
    }
  }
  return {
    key,
    word: entry?.word ?? key,
    reading: entry?.reading ?? '',
    romaji: entry?.romaji ?? '',
    meaning: entry?.meaning ?? '',
    partOfSpeech: entry?.partOfSpeech ?? '',
    songs: inSongs,
  };
}

// All vocabulary across the library, deduplicated by normalized word, with
// the songs containing it and one example lyric line for flashcard hints.
export async function allVocab() {
  const songs = await allSongs();
  const map = new Map();
  for (const s of songs) {
    for (const v of s.vocabulary) {
      const key = normalize(v.word);
      if (!map.has(key)) {
        map.set(key, {
          key,
          word: v.word,
          reading: v.reading,
          romaji: v.romaji,
          meaning: v.meaning,
          partOfSpeech: v.partOfSpeech,
          songs: [],
          example: null,
        });
      }
      const entry = map.get(key);
      entry.songs.push({ id: s.id, title: s.title, artist: s.artist });
      if (!entry.example) {
        const line = findExampleLine(s.lines ?? [], v.word);
        if (line) entry.example = { songId: s.id, title: s.title, line: line.kanji, kana: line.kana };
      }
    }
  }
  return [...map.values()];
}

// Vocabulary is in dictionary form but lyrics may conjugate it, so the word
// is shortened from the end (down to 2 chars) until a line contains it.
function findExampleLine(lines, word) {
  const w = normalize(word);
  for (let len = w.length; len >= Math.min(w.length, 2); len--) {
    const fragment = w.slice(0, len);
    const hit = lines.find((l) => l.kanji?.includes(fragment));
    if (hit) return hit;
  }
  return null;
}

// ---- first-run seeding ----------------------------------------------------

export async function isSeeded() {
  return Boolean(await kvGet('seeded', false));
}

// Imports an existing library (from the server's /api/export) into IndexedDB,
// but only once and only if empty, so we never clobber on-device data.
export async function seed({ songs = [], saved = [], learnt = [], model } = {}) {
  const db = await dbPromise;
  const existing = await db.count('songs');
  if (existing === 0 && songs.length) {
    const tx = db.transaction('songs', 'readwrite');
    for (const s of songs) tx.store.put(s);
    await tx.done;
  }
  if (saved.length && (await getSaved()).length === 0) await kvSet('saved', saved);
  if (learnt.length && (await getLearnt()).length === 0) await kvSet('learnt', learnt);
  if (model && (await kvGet('model')) === undefined) await kvSet('model', model);
  await kvSet('seeded', true);
}
