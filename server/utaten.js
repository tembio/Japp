import { parse } from 'node-html-parser';
import { getHtml, JAPANESE, cleanLines } from './scrape.js';

const BASE = 'https://utaten.com';

// Fallback lyrics source. Searches utaten.com and scrapes the first result,
// stripping the inline furigana (<span class="rt">) to leave clean kanji/kana.
export async function findLyrics(title, artist) {
  const params = new URLSearchParams({ title: title ?? '', artist_name: artist ?? '' });
  const searchHtml = await getHtml(`${BASE}/lyric/search?${params}`);
  if (!searchHtml) return null;

  // Only real search results (`.searchResult__title a`) count — the page also
  // shows a "newest lyrics" widget (.newestList__title) that must be ignored, so
  // a no-result search returns null instead of an unrelated song.
  const href = parse(searchHtml)
    .querySelectorAll('.searchResult__title a')
    .map((a) => a.getAttribute('href'))
    .find((h) => h && /^\/lyric\/[a-zA-Z0-9]+\/?$/.test(h));
  if (!href) return null;

  const pageHtml = await getHtml(BASE + href);
  if (!pageHtml) return null;

  const box = parse(pageHtml).querySelector('.hiragana') || parse(pageHtml).querySelector('.lyricBody');
  if (!box) return null;
  box.querySelectorAll('.rt, rt, rp').forEach((el) => el.remove()); // drop furigana
  const text = cleanLines(parse(box.innerHTML.replace(/<br\s*\/?>/gi, '\n')).text);
  return JAPANESE.test(text) ? text : null;
}
