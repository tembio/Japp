// Shared helpers for scraping lyric sites (j-lyric.net, utaten.com). Both serve
// plain HTML with no bot protection, so a simple fetch works server-side.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Fetches a URL as text with a browser-like UA and a timeout; returns null on
// any failure so callers can fall through to the next source.
export async function getHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' },
      signal: ctrl.signal,
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Hiragana, katakana, or kanji — used to confirm a scrape actually returned
// Japanese lyrics rather than a stray/empty page.
export const JAPANESE = /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u;

export function cleanLines(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/ /g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
