import { getSettings } from './store.js';
import { MODELS } from './models.js';
import * as gemini from './gemini.js';
import * as deepseek from './deepseek.js';

// Lyrics search needs web grounding, which only Gemini offers — it always
// runs on Gemini regardless of the selected analysis model.
export const findLyrics = gemini.findLyrics;

// The model is chosen on the client now and passed in per request; it falls
// back to the server's stored setting if absent.
export function analyzeLyrics(lyrics, meta, model) {
  const m = model ?? getSettings().model;
  const provider = MODELS.find((mm) => mm.id === m)?.provider ?? 'gemini';
  console.log(`Analyzing with ${m} (${provider})`);
  return provider === 'deepseek'
    ? deepseek.analyzeLyrics(m, lyrics, meta)
    : gemini.analyzeLyrics(lyrics, meta, m);
}
