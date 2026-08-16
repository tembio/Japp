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
      // *_keys hold everything ever added; deleted_keys / removed_saved /
      // removed_learnt are tombstones so a restore doesn't bring back things
      // the user explicitly removed (see putUserLibrary).
      await db.execute(
        `CREATE TABLE IF NOT EXISTS user_libraries (
          user_id        TEXT PRIMARY KEY,
          song_keys      TEXT NOT NULL,
          deleted_keys   TEXT NOT NULL DEFAULT '[]',
          saved          TEXT NOT NULL,
          learnt         TEXT NOT NULL,
          removed_saved  TEXT NOT NULL DEFAULT '[]',
          removed_learnt TEXT NOT NULL DEFAULT '[]',
          updated_at     TEXT NOT NULL
        )`
      );
      // One-time migrations for tables created before these columns existed.
      await db
        .execute("ALTER TABLE user_libraries ADD COLUMN deleted_keys TEXT NOT NULL DEFAULT '[]'")
        .catch(() => {});
      await db
        .execute("ALTER TABLE user_libraries ADD COLUMN removed_saved TEXT NOT NULL DEFAULT '[]'")
        .catch(() => {});
      await db
        .execute("ALTER TABLE user_libraries ADD COLUMN removed_learnt TEXT NOT NULL DEFAULT '[]'")
        .catch(() => {});
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

// Raw row, including all ever-added references. Used internally.
async function getUserLibraryRow(userId) {
  if (!db || !userId) return null;
  try {
    await ready;
    const res = await db.execute({
      sql: 'SELECT song_keys, deleted_keys, saved, learnt, removed_saved, removed_learnt FROM user_libraries WHERE user_id = ?',
      args: [userId],
    });
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      songKeys: JSON.parse(r.song_keys),
      deletedKeys: JSON.parse(r.deleted_keys ?? '[]'),
      saved: JSON.parse(r.saved),
      learnt: JSON.parse(r.learnt),
      removedSaved: JSON.parse(r.removed_saved ?? '[]'),
      removedLearnt: JSON.parse(r.removed_learnt ?? '[]'),
    };
  } catch (err) {
    logError('userLib.get', err);
    return null;
  }
}

// The restore view: everything the user hasn't explicitly removed (all-time
// sets minus tombstones), plus the tombstones so clients can mirror them.
export async function getUserLibrary(userId) {
  const row = await getUserLibraryRow(userId);
  if (!row) return null;
  const deleted = new Set(row.deletedKeys);
  const removedSaved = new Set(row.removedSaved);
  const removedLearnt = new Set(row.removedLearnt);
  return {
    ...row,
    songKeys: row.songKeys.filter((k) => !deleted.has(k)),
    saved: row.saved.filter((w) => !removedSaved.has(w)),
    learnt: row.learnt.filter((w) => !removedLearnt.has(w)),
  };
}

export async function putUserLibrary(
  userId,
  { songKeys = [], saved = [], learnt = [], deleteKeys = [], removeSaved = [], removeLearnt = [] } = {}
) {
  if (!db || !userId) return;
  try {
    await ready;
    // Merge, never replace: a device whose local library is empty or partially
    // restored must not be able to wipe songs or words out of the backup.
    // Removals are explicit (deleteKeys / removeSaved / removeLearnt) and
    // recorded as tombstones, so a later restore excludes them. Anything the
    // client currently holds is never treated as removed (this resurrects
    // re-added songs / re-starred words).
    const existing = await getUserLibraryRow(userId);
    const heldSongs = new Set(songKeys);
    const heldSaved = new Set(saved);
    const heldLearnt = new Set(learnt);
    const mergedKeys = [...new Set([...(existing?.songKeys ?? []), ...songKeys])];
    const mergedDeleted = [...new Set([...(existing?.deletedKeys ?? []), ...deleteKeys])].filter(
      (k) => !heldSongs.has(k)
    );
    const mergedSaved = [...new Set([...(existing?.saved ?? []), ...saved])];
    const mergedLearnt = [...new Set([...(existing?.learnt ?? []), ...learnt])];
    const mergedRemovedSaved = [
      ...new Set([...(existing?.removedSaved ?? []), ...removeSaved]),
    ].filter((w) => !heldSaved.has(w));
    const mergedRemovedLearnt = [
      ...new Set([...(existing?.removedLearnt ?? []), ...removeLearnt]),
    ].filter((w) => !heldLearnt.has(w));
    await db.execute({
      sql: `INSERT OR REPLACE INTO user_libraries
            (user_id, song_keys, deleted_keys, saved, learnt, removed_saved, removed_learnt, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        userId,
        JSON.stringify(mergedKeys),
        JSON.stringify(mergedDeleted),
        JSON.stringify(mergedSaved),
        JSON.stringify(mergedLearnt),
        JSON.stringify(mergedRemovedSaved),
        JSON.stringify(mergedRemovedLearnt),
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
