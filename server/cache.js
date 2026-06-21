import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import { logError } from './logger.js';

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
