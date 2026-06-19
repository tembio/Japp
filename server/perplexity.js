import { getApiKey } from './store.js';
import { userError, logError } from './logger.js';

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';

// Lyrics lookup via Perplexity's web-grounded Sonar model. Replaces the Gemini
// grounded search (whose free-tier quota kept 429-ing). Returns the Japanese
// lyrics, or throws a user-facing error so the UI can suggest pasting them.
export async function findLyrics(title, artist) {
  const apiKey = getApiKey('perplexity');
  if (!apiKey) {
    throw userError(
      'No Perplexity API key configured. Add PERPLEXITY_API_KEY (from perplexity.ai/account/api), or paste the lyrics instead.'
    );
  }

  const prompt =
    `Find the original Japanese lyrics of the song "${title}"` +
    (artist ? ` by "${artist}"` : '') +
    '. Respond with ONLY the Japanese lyrics, one line per lyric line — ' +
    'no title, no artist, no romaji, no translation, no commentary, and no source ' +
    'citations or footnote markers. If you cannot find them with reasonable ' +
    'confidence, respond with exactly: NOT_FOUND';

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar',
        temperature: 0,
        messages: [
          { role: 'system', content: 'You are a precise lyrics lookup tool. Output only what is requested, nothing else.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
  } catch (err) {
    logError('perplexity.findLyrics fetch', err);
    throw userError('Could not reach Perplexity. Check your connection and try again.');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logError(`perplexity.findLyrics HTTP ${res.status}`, body.slice(0, 500));
    if (res.status === 401 || res.status === 403) {
      throw userError('Perplexity rejected the request — check that PERPLEXITY_API_KEY is valid and has credit.');
    }
    if (res.status === 429) {
      throw userError('Perplexity is rate-limited or out of credit right now. Try again shortly, or paste the lyrics.', 503);
    }
    throw userError('The lyrics lookup failed. Please try again, or paste the lyrics instead.');
  }

  const data = await res.json().catch(() => ({}));
  // Strip any [1][2]-style citation markers Sonar may append.
  const text = (data.choices?.[0]?.message?.content ?? '').replace(/\[\d+\]/g, '').trim();
  if (!text || /NOT_FOUND/.test(text)) {
    throw userError(
      `Could not find lyrics for "${title}"${artist ? ` by ${artist}` : ''}. Try pasting the lyrics instead.`,
      404
    );
  }
  return text;
}
