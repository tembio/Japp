import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logError } from './logger.js';

// The env vars must be present before they're read below, but index.js loads
// .env in its module body — after ESM imports run. Load it here too so the
// Turso cache works in local dev (a no-op when the vars come from the shell,
// e.g. Render, or when there's no .env).
try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch {
  // no .env — vars are expected to come from the environment
}

// Server-side cache of processed analyses, backed by Turso (libSQL/SQLite) so it
// survives Render's ephemeral filesystem. Configure with TURSO_DATABASE_URL (+
// TURSO_AUTH_TOKEN for hosted; a `file:` URL works for local dev). When unset,
// the cache is a no-op and the app behaves exactly as before.
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

export const cacheEnabled = Boolean(url);

let db = null;
let ready = Promise.resolve();
if (cacheEnabled) {
  db = createClient({ url, authToken });
  ready = (async () => {
    try {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS analysis_cache (
          key TEXT PRIMARY KEY,
          title TEXT,
          artist TEXT,
          analysis TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`
      );
      // One-time migration: drop the legacy unused `model` column if an older
      // DB still has it (no-op on fresh DBs; errors ignored).
      await db.execute('ALTER TABLE analysis_cache DROP COLUMN model').catch(() => {});
      // Remove legacy query-key rows: the cache is keyed solely by lyrics
      // fingerprint now, so `q:` rows just duplicate a `lyrics:` row.
      await db.execute("DELETE FROM analysis_cache WHERE key LIKE 'q:%'").catch(() => {});
      // Per-user library backup: just the song fingerprints (lyrics keys) and
      // saved/learnt word lists. The songs themselves live in analysis_cache.
      await db.execute(
        `CREATE TABLE IF NOT EXISTS user_libraries (
          user_id    TEXT PRIMARY KEY,
          song_keys  TEXT NOT NULL,
          saved      TEXT NOT NULL,
          learnt     TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      );
    } catch (err) {
      logError('cache.init', err);
      db = null; // disable on failure so analyze still works
    }
  })();
}

const normalize = (s) => (s ?? '').trim().replace(/\s+/g, '').toLowerCase();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The cache key: a fingerprint of the lyrics, so the same song maps to one row
// however it was found (search or paste, regardless of title spelling).
export const lyricsKey = (text) => 'lyrics:' + sha256(normalize(text));

export async function getCached(key) {
  if (!db || !key) return null;
  try {
    await ready;
    const res = await db.execute({
      sql: 'SELECT analysis FROM analysis_cache WHERE key = ?',
      args: [key],
    });
    return res.rows.length ? JSON.parse(res.rows[0].analysis) : null;
  } catch (err) {
    logError('cache.get', err);
    return null;
  }
}

export async function putCached(key, { title, artist } = {}, analysis) {
  if (!db || !key) return;
  try {
    await ready;
    await db.execute({
      sql: `INSERT OR REPLACE INTO analysis_cache (key, title, artist, analysis, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [key, title ?? '', artist ?? '', JSON.stringify(analysis), new Date().toISOString()],
    });
  } catch (err) {
    logError('cache.put', err);
  }
}

// ---- per-user library backup ----------------------------------------------
// The client owns its library; this table is a backup of just the references
// (song fingerprints + saved/learnt words) so a redeploy can't lose them.

export async function getUserLibrary(userId) {
  if (!db || !userId) return null;
  try {
    await ready;
    const res = await db.execute({
      sql: 'SELECT song_keys, saved, learnt FROM user_libraries WHERE user_id = ?',
      args: [userId],
    });
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      songKeys: JSON.parse(r.song_keys),
      saved: JSON.parse(r.saved),
      learnt: JSON.parse(r.learnt),
    };
  } catch (err) {
    logError('userLib.get', err);
    return null;
  }
}

export async function putUserLibrary(userId, { songKeys = [], saved = [], learnt = [] } = {}) {
  if (!db || !userId) return;
  try {
    await ready;
    await db.execute({
      sql: `INSERT OR REPLACE INTO user_libraries (user_id, song_keys, saved, learnt, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        userId,
        JSON.stringify(songKeys),
        JSON.stringify(saved),
        JSON.stringify(learnt),
        new Date().toISOString(),
      ],
    });
  } catch (err) {
    logError('userLib.put', err);
  }
}

// Returns the full cached analyses for a list of song keys (lyric fingerprints
// as stored by the client). Unknown keys are skipped.
export async function getSongsByKeys(keys) {
  if (!db || !Array.isArray(keys) || !keys.length) return [];
  const songs = [];
  try {
    await ready;
    for (const key of keys) {
      if (!key) continue;
      const res = await db.execute({
        sql: 'SELECT title, artist, analysis FROM analysis_cache WHERE key = ?',
        args: ['lyrics:' + key],
      });
      if (res.rows.length) {
        songs.push({ key, analysis: JSON.parse(res.rows[0].analysis) });
      }
    }
  } catch (err) {
    logError('userLib.songs', err);
  }
  return songs;
}
