import { analysisPrompt, JSON_SPEC } from './prompt.js';
import { userError, logError } from './logger.js';
import { getApiKey } from './store.js';

const BASE_URL = 'https://api.deepseek.com';

export async function analyzeLyrics(model, lyrics, meta = {}) {
  const apiKey = getApiKey('deepseek');
  if (!apiKey) {
    throw userError(
      'No DeepSeek API key configured. Add one in Config → API keys (from platform.deepseek.com), or switch to a Gemini model.'
    );
  }

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: analysisPrompt(lyrics, meta) + '\n' + JSON_SPEC }],
        response_format: { type: 'json_object' },
        // V4 Pro turns thinking mode on by default, adding a long reasoning
        // pass before the answer — unnecessary for structured extraction.
        thinking: { type: 'disabled' },
        // The default output cap truncates full-song analyses (per-word
        // segmentation makes them large), producing unparseable JSON.
        max_tokens: 32768,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const choice = data.choices[0];
      if (choice.finish_reason === 'length') {
        throw userError(
          'The AI response hit the output limit — the song may be too long. Try splitting the lyrics or switching model.'
        );
      }
      try {
        return JSON.parse(choice.message.content);
      } catch (err) {
        logError(`deepseek.analyzeLyrics JSON parse (${model})`, err);
        throw userError('The AI returned an unexpected response. Please try again, or switch model in the sidebar settings.');
      }
    }

    const transient = res.status === 429 || res.status === 503;
    if (!transient || attempt >= 3) {
      const body = await res.text().catch(() => '');
      logError(`deepseek.analyzeLyrics (${model}) HTTP ${res.status}`, body.slice(0, 500));
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw userError(
          'DeepSeek rejected the request — check that your API key is valid and your account has balance, or switch to a Gemini model.'
        );
      }
      throw userError(
        transient
          ? `DeepSeek (${model}) is overloaded right now. Try again in a minute, or switch model in the sidebar settings.`
          : 'The AI request failed. Please try again, or switch model in the sidebar settings.',
        transient ? 503 : 500
      );
    }
    console.warn(`DeepSeek ${res.status} from ${model}, retrying (attempt ${attempt}/3)…`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}
