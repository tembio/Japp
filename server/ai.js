import { MODELS, DEFAULT_MODEL } from './models.js';
import * as deepseek from './deepseek.js';
import * as jlyric from './jlyric.js';
import * as utaten from './utaten.js';
import { userError } from './logger.js';

// Lyrics search scrapes Japanese lyric sites (no API key, no bot protection):
// j-lyric.net first, then utaten.com. If neither has it, the user pastes them.
export async function findLyrics(title, artist) {
  const fromJ = await jlyric.findLyrics(title, artist);
  if (fromJ) {
    console.log('Lyrics found via j-lyric.net');
    return fromJ;
  }
  const fromU = await utaten.findLyrics(title, artist);
  if (fromU) {
    console.log('Lyrics found via utaten.com');
    return fromU;
  }
  throw userError(
    `Could not find lyrics for "${title}"${artist ? ` by ${artist}` : ''}. Try pasting the lyrics instead.`,
    404
  );
}

// Analysis runs on DeepSeek (the only provider). Unknown/stale model ids — e.g.
// an old Gemini id left in a client — fall back to the default.
export function analyzeLyrics(lyrics, meta, model) {
  const m = MODELS.some((mm) => mm.id === model) ? model : DEFAULT_MODEL;
  console.log(`Analyzing with ${m}`);
  return deepseek.analyzeLyrics(m, lyrics, meta);
}
