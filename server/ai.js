import { MODELS, DEFAULT_MODEL } from './models.js';
import * as deepseek from './deepseek.js';
import * as perplexity from './perplexity.js';

// Lyrics search runs on Perplexity's web-grounded Sonar model.
export const findLyrics = perplexity.findLyrics;

// Analysis runs on DeepSeek (the only provider). Unknown/stale model ids — e.g.
// an old Gemini id left in a client — fall back to the default.
export function analyzeLyrics(lyrics, meta, model) {
  const m = MODELS.some((mm) => mm.id === model) ? model : DEFAULT_MODEL;
  console.log(`Analyzing with ${m}`);
  return deepseek.analyzeLyrics(m, lyrics, meta);
}
