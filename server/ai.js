import { MODELS, DEFAULT_MODEL } from './models.js';
import * as deepseek from './deepseek.js';
import * as jlyric from './jlyric.js';
import * as utaten from './utaten.js';
import * as lyricstranslate from './lyricstranslate.js';
import { userError } from './logger.js';

const HAS_JAPANESE = /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u;

// Lyrics search scrapes plain-HTML lyric sites (no API key, no bot protection),
// routed by input script: Japanese title/artist → j-lyric.net then utaten.com
// (both indexed by Japanese text); romaji/Latin input → lyricstranslate.com
// (searchable by romanized name, hosts the original Japanese lyrics).
export async function findLyrics(title, artist) {
  const japanese = HAS_JAPANESE.test(`${title ?? ''} ${artist ?? ''}`);
  const sources = japanese
    ? [['j-lyric.net', jlyric], ['utaten.com', utaten]]
    : [['lyricstranslate.com', lyricstranslate]];

  for (const [name, source] of sources) {
    const lyrics = await source.findLyrics(title, artist);
    if (lyrics) {
      console.log(`Lyrics found via ${name}`);
      return lyrics;
    }
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
