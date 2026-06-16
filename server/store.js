import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { DEFAULT_MODEL } from './models.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'songs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LEARNT_FILE = path.join(DATA_DIR, 'learnt.json');
const SAVED_FILE = path.join(DATA_DIR, 'saved.json');

function readList(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeList(file, list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

export function getLearnt() {
  return readList(LEARNT_FILE);
}

export function getSaved() {
  return readList(SAVED_FILE);
}

export function addSaved(word) {
  const set = new Set(getSaved());
  set.add(normalize(word));
  writeList(SAVED_FILE, [...set]);
  return [...set];
}

export function removeSaved(word) {
  const next = getSaved().filter((w) => w !== normalize(word));
  writeList(SAVED_FILE, next);
  return next;
}

// "My words" = every word the user has engaged with (saved or learnt),
// enriched with details, the songs it appears in, and its saved/learnt flags.
export function myWords() {
  const db = load();
  const savedSet = new Set(getSaved());
  const learntSet = new Set(getLearnt());
  const keys = new Set([...savedSet, ...learntSet]);
  return [...keys]
    .map((key) => ({
      ...wordDetail(db, key),
      saved: savedSet.has(key),
      learnt: learntSet.has(key),
    }))
    .sort((a, b) => a.word.localeCompare(b.word, 'ja'));
}

function wordDetail(db, key) {
  let entry = null;
  const songs = [];
  for (const s of db.songs) {
    const v = s.vocabulary.find((vv) => normalize(vv.word) === key);
    if (v) {
      entry ??= v;
      songs.push({ id: s.id, title: s.title, artist: s.artist });
    }
  }
  return {
    key,
    word: entry?.word ?? key,
    reading: entry?.reading ?? '',
    romaji: entry?.romaji ?? '',
    meaning: entry?.meaning ?? '',
    partOfSpeech: entry?.partOfSpeech ?? '',
    songs,
  };
}

export function addLearnt(word) {
  const set = new Set(getLearnt());
  set.add(normalize(word));
  writeList(LEARNT_FILE, [...set]);
  return [...set];
}

// All vocabulary across the library, deduplicated by normalized word, with
// the songs containing it and one example lyric line for flashcard hints.
export function allVocab() {
  const db = load();
  const map = new Map();
  for (const s of db.songs) {
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

export function removeLearnt(word) {
  const next = getLearnt().filter((w) => w !== normalize(word));
  writeList(LEARNT_FILE, next);
  return next;
}

export function getSettings() {
  try {
    return { model: DEFAULT_MODEL, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { model: DEFAULT_MODEL };
  }
}

export function saveSettings(settings) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  return settings;
}

const ENV_KEY_NAMES = { gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };

// Keys saved from the UI (data/settings.json) take precedence over .env.
export function getApiKey(provider) {
  return getSettings().keys?.[provider] || process.env[ENV_KEY_NAMES[provider]];
}

export function apiKeyMeta(provider) {
  const ui = getSettings().keys?.[provider];
  const env = process.env[ENV_KEY_NAMES[provider]];
  const key = ui || env;
  return {
    set: Boolean(key),
    source: ui ? 'ui' : env ? 'env' : null,
    hint: key ? `…${key.slice(-4)}` : null,
  };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { songs: [] };
  }
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// One-time dump of the legacy file-backed library, used by GET /api/export so
// the client can seed its IndexedDB on first launch (preserving existing data).
export function exportData() {
  return {
    songs: load().songs,
    saved: getSaved(),
    learnt: getLearnt(),
    model: getSettings().model,
  };
}

export function listSongs() {
  return load().songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    addedAt: s.addedAt,
    vocabCount: s.vocabulary.length,
    grammarCount: s.grammar.length,
  }));
}

export function getSong(id) {
  const db = load();
  const song = db.songs.find((s) => s.id === id);
  if (!song) return null;
  return withLiveSeenIn(song, db);
}

// seenIn is recomputed from the current library on every read, so references
// stay clickable (always {id, title, artist}) and never point at deleted
// songs. The values stored at addSong time are only a snapshot.
function withLiveSeenIn(song, db) {
  const vocabIndex = new Map();
  const grammarIndex = new Map();
  for (const s of db.songs) {
    if (s.id === song.id) continue;
    const ref = { id: s.id, title: s.title, artist: s.artist };
    for (const v of s.vocabulary) {
      const key = normalize(v.word);
      if (!vocabIndex.has(key)) vocabIndex.set(key, []);
      vocabIndex.get(key).push(ref);
    }
    for (const g of s.grammar) {
      const key = normalize(g.pattern);
      if (!grammarIndex.has(key)) grammarIndex.set(key, []);
      grammarIndex.get(key).push(ref);
    }
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

export function deleteSong(id) {
  const db = load();
  const before = db.songs.length;
  db.songs = db.songs.filter((s) => s.id !== id);
  save(db);
  return db.songs.length < before;
}

// Returns a previously saved song matching the search query (title/artist,
// also checked against what the user originally typed) or pasted lyrics.
export function findExisting({ title, artist, lyricsKey }) {
  const t = normalizeLoose(title);
  const a = normalizeLoose(artist);
  return (
    load().songs.find((s) => {
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
export function addSong(analysis, { query, lyricsKey, model } = {}) {
  const db = load();

  const vocabIndex = new Map(); // normalized word -> [{id, title, artist}]
  const grammarIndex = new Map();
  for (const s of db.songs) {
    const ref = { id: s.id, title: s.title, artist: s.artist };
    for (const v of s.vocabulary) {
      const key = normalize(v.word);
      if (!vocabIndex.has(key)) vocabIndex.set(key, []);
      vocabIndex.get(key).push(ref);
    }
    for (const g of s.grammar) {
      const key = normalize(g.pattern);
      if (!grammarIndex.has(key)) grammarIndex.set(key, []);
      grammarIndex.get(key).push(ref);
    }
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

  db.songs.push(song);
  save(db);
  return song;
}

function normalize(text) {
  return (text ?? '').trim().replace(/\s+/g, '');
}

// Models sometimes return "Unknown" instead of the empty string the schema
// asks for.
function cleanArtist(artist) {
  const a = (artist ?? '').trim();
  return /^(unknown( artist)?|不明|n\/a|none)$/i.test(a) ? '' : a;
}

function normalizeLoose(text) {
  return normalize(text).toLowerCase();
}
