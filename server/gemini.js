import { GoogleGenAI, Type } from '@google/genai';
import { getSettings, getApiKey } from './store.js';
import { MODELS, DEFAULT_MODEL } from './models.js';
import { analysisPrompt } from './prompt.js';
import { userError, logError } from './logger.js';

let client;
let clientKey;
function ai() {
  const key = getApiKey('gemini');
  if (!key) {
    throw userError(
      'No Gemini API key configured. Add one in Config → API keys (get it free at aistudio.google.com/apikey).'
    );
  }
  if (!client || clientKey !== key) {
    client = new GoogleGenAI({ apiKey: key });
    clientKey = key;
  }
  return client;
}

// Falls back to the default Gemini model when a non-Gemini model is selected
// (e.g. lyrics search always runs on Gemini for its web grounding).
function geminiModelFor(model) {
  const chosen = model ?? getSettings().model;
  const isGemini = MODELS.some((m) => m.id === chosen && m.provider === 'gemini');
  return isGemini ? chosen : DEFAULT_MODEL;
}

// Retries on 503 (model overloaded) and 429 (rate limited), which are
// transient on the free tier.
async function generate(params, modelOverride) {
  const model = geminiModelFor(modelOverride);
  for (let attempt = 1; ; attempt++) {
    try {
      return await ai().models.generateContent({ model, ...params });
    } catch (err) {
      if (err.expose) throw err;
      const code = err.status ?? err.code;
      const transient = code === 503 || code === 429;
      if (!transient || attempt >= 3) {
        logError(`gemini.generate (${model})`, err);
        throw userError(
          transient
            ? `Gemini (${model}) is overloaded right now. Try again in a minute, or switch model in the sidebar settings.`
            : 'The AI request failed. Please try again, or switch model in the sidebar settings.',
          transient ? 503 : 500
        );
      }
      console.warn(`Gemini ${code} from ${model}, retrying (attempt ${attempt}/3)…`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// Search grounding can't be combined with structured output, so lyrics
// lookup is a separate plain-text call.
export async function findLyrics(title, artist, model) {
  const res = await generate({
    contents:
      `Find the original Japanese lyrics of the song "${title}"` +
      (artist ? ` by "${artist}"` : '') +
      '. Use web search to locate them. Respond with ONLY the Japanese lyrics, ' +
      'one line per lyric line, no titles, no translations, no commentary. ' +
      'If you cannot find the lyrics with reasonable confidence, respond with exactly: NOT_FOUND',
    config: {
      tools: [{ googleSearch: {} }],
    },
  }, model);
  const text = (res.text ?? '').trim();
  if (!text || text.includes('NOT_FOUND')) {
    throw userError(
      `Could not find lyrics for "${title}"${artist ? ` by ${artist}` : ''}. Try pasting the lyrics instead.`,
      404
    );
  }
  return text;
}

const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Song title if known or inferable, else a short label' },
    artist: { type: Type.STRING, description: 'Artist if known, else empty string — never the word "Unknown"' },
    summary: { type: Type.STRING, description: '2-3 sentence summary in English of what the song is about' },
    lines: {
      type: Type.ARRAY,
      description: 'Every lyric line in three scripts. Keep blank lines between stanzas as entries with empty strings.',
      items: {
        type: Type.OBJECT,
        properties: {
          kanji: { type: Type.STRING, description: 'Original line (kanji + kana)' },
          kana: { type: Type.STRING, description: 'Same line fully in hiragana (katakana kept for loanwords)' },
          romaji: { type: Type.STRING, description: 'Same line in Hepburn romaji' },
          translation: { type: Type.STRING, description: 'Natural English translation of the line' },
          section: {
            type: Type.STRING,
            enum: ['intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'outro', 'other'],
            description: 'Song section this line belongs to, judged from structure and repetition',
          },
          words: {
            type: Type.ARRAY,
            description:
              'Word-by-word segmentation of the line, in order, covering every word including particles. Concatenating the "word" values must reproduce the line. Empty array for blank lines.',
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING, description: 'The word exactly as it appears in the line (surface form)' },
                reading: { type: Type.STRING, description: 'Reading in kana as pronounced in this line' },
                romaji: { type: Type.STRING, description: 'Hepburn romaji of the reading' },
                meaning: { type: Type.STRING, description: 'Short English gloss; for particles, their function (e.g. "を — direct object marker")' },
              },
              required: ['word', 'reading', 'romaji', 'meaning'],
            },
          },
        },
        required: ['kanji', 'kana', 'romaji', 'translation', 'section', 'words'],
      },
    },
    vocabulary: {
      type: Type.ARRAY,
      description: 'Key vocabulary worth learning, in dictionary form, no duplicates',
      items: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING, description: 'Dictionary form, as written in the song (kanji if applicable)' },
          reading: { type: Type.STRING, description: 'Reading in hiragana/katakana' },
          romaji: { type: Type.STRING },
          meaning: { type: Type.STRING, description: 'Concise English meaning' },
          partOfSpeech: {
            type: Type.STRING,
            description:
              'One of: noun, verb (with conjugation type, e.g. "verb (ichidan)"), i-adjective, na-adjective, adverb, expression. Use "expression" for idioms and set phrases.',
          },
        },
        required: ['word', 'reading', 'romaji', 'meaning', 'partOfSpeech'],
      },
    },
    grammar: {
      type: Type.ARRAY,
      description: 'Grammar structures, verb forms, and expressions used in the song',
      items: {
        type: Type.OBJECT,
        properties: {
          pattern: { type: Type.STRING, description: 'The grammar pattern, e.g. 〜てしまう' },
          label: { type: Type.STRING, description: 'Short English name, e.g. "te-form + shimau (regret/completion)"' },
          explanation: { type: Type.STRING, description: '1-2 sentence explanation of meaning and usage' },
          example: { type: Type.STRING, description: 'The line from the song where it appears' },
        },
        required: ['pattern', 'label', 'explanation', 'example'],
      },
    },
  },
  required: ['title', 'artist', 'summary', 'lines', 'vocabulary', 'grammar'],
};

export async function analyzeLyrics(lyrics, meta = {}, model) {
  const res = await generate({
    contents: analysisPrompt(lyrics, meta),
    config: {
      responseMimeType: 'application/json',
      responseSchema: analysisSchema,
      // Full-song analyses with per-word segmentation can exceed the default
      // output cap, which truncates the JSON mid-string.
      maxOutputTokens: 65536,
    },
  }, model);
  if (res.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
    throw userError(
      'The AI response hit the output limit — the song may be too long. Try splitting the lyrics or switching model.'
    );
  }
  try {
    return JSON.parse(res.text);
  } catch (err) {
    logError('gemini.analyzeLyrics JSON parse', err);
    throw userError('The AI returned an unexpected response. Please try again, or switch model in the sidebar settings.');
  }
}
