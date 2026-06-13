import { getSettings } from './store.js';
import { MODELS } from './models.js';
import * as gemini from './gemini.js';
import * as deepseek from './deepseek.js';

// Lyrics search needs web grounding, which only Gemini offers — it always
// runs on Gemini regardless of the selected analysis model.
export const findLyrics = gemini.findLyrics;

export function analyzeLyrics(lyrics, meta) {
  const { model } = getSettings();
  const provider = MODELS.find((m) => m.id === model)?.provider ?? 'gemini';
  console.log(`Analyzing with ${model} (${provider})`);
  return provider === 'deepseek'
    ? deepseek.analyzeLyrics(model, lyrics, meta)
    : gemini.analyzeLyrics(lyrics, meta);
}
