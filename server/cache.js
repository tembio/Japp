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
  ready = db
    .execute(
      `CREATE TABLE IF NOT EXISTS analysis_cache (
        key TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        model TEXT,
        analysis TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    )
    .catch((err) => {
      logError('cache.init', err);
      db = null; // disable on failure so analyze still works
    });
}

const normalize = (s) => (s ?? '').trim().replace(/\s+/g, '').toLowerCase();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Key for pasted/known lyrics (same lyrics → same key, regardless of title).
export const lyricsKey = (text) => 'lyrics:' + sha256(normalize(text));
// Key for a title/artist search (so repeat searches hit before scraping).
export const queryKey = (title, artist) => 'q:' + normalize(title) + '|' + normalize(artist);

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

export async function putCached(key, { title, artist, model } = {}, analysis) {
  if (!db || !key) return;
  try {
    await ready;
    await db.execute({
      sql: `INSERT OR REPLACE INTO analysis_cache (key, title, artist, model, analysis, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [key, title ?? '', artist ?? '', model ?? '', JSON.stringify(analysis), new Date().toISOString()],
    });
  } catch (err) {
    logError('cache.put', err);
  }
}
