export function analysisPrompt(lyrics, { title, artist } = {}) {
  const hint =
    title || artist ? `The song is "${title ?? 'unknown'}"${artist ? ` by ${artist}` : ''}. ` : '';
  return (
    'You are a Japanese teacher helping a student learn Japanese through song lyrics. ' +
    hint +
    'Analyze the following Japanese lyrics. Transcribe every line into the three scripts, ' +
    'translate every line into natural English, ' +
    'segment every line word by word (including particles) with readings and short glosses, ' +
    'extract the vocabulary a learner should study (skip particles and trivial words like は/が/の), ' +
    'and identify the grammar patterns used.\n\nLYRICS:\n' +
    lyrics
  );
}

// JSON shape spec for the analysis response (DeepSeek returns a JSON object).
export const JSON_SPEC = `
Respond with ONLY valid JSON (no markdown fences) in exactly this shape:
{
  "title": "song title if known or inferable, else a short label",
  "artist": "artist if known, else empty string — never the word Unknown",
  "summary": "2-3 sentence summary in English of what the song is about",
  "lines": [
    { "kanji": "original line (kanji + kana)",
      "kana": "same line fully in hiragana (katakana kept for loanwords)",
      "romaji": "same line in Hepburn romaji",
      "translation": "natural English translation of the line",
      "section": "one of: intro, verse, pre-chorus, chorus, bridge, outro, other — judged from structure and repetition",
      "words": [
        { "word": "word exactly as it appears in the line (surface form)",
          "reading": "reading in kana as pronounced in this line",
          "romaji": "Hepburn romaji of the reading",
          "meaning": "short English gloss; for particles, their function" }
      ] }
  ],
  "vocabulary": [
    { "word": "dictionary form, as written in the song",
      "reading": "reading in hiragana/katakana",
      "romaji": "...",
      "meaning": "concise English meaning",
      "partOfSpeech": "one of: noun, verb (with conjugation type, e.g. verb (ichidan)), i-adjective, na-adjective, adverb, expression — use expression for idioms and set phrases" }
  ],
  "grammar": [
    { "pattern": "the grammar pattern, e.g. 〜てしまう",
      "label": "short English name, e.g. te-form + shimau (regret/completion)",
      "explanation": "1-2 sentence explanation of meaning and usage",
      "example": "the line from the song where it appears" }
  ]
}
Include every lyric line in "lines" (keep blank stanza separators as entries with empty strings). No duplicate vocabulary entries.`;
