import { parse } from 'node-html-parser';
import { getHtml, JAPANESE, cleanLines } from './scrape.js';

const BASE = 'https://j-lyric.net';

// Searches j-lyric.net by title (+ artist) and scrapes the lyrics off the first
// result page. Returns the lyrics text, or null so the caller can fall back.
export async function findLyrics(title, artist) {
  const params = new URLSearchParams({
    kt: title ?? '', // title keyword
    ka: artist ?? '', // artist keyword
    ct: '2', // partial title match
    ca: '2', // partial artist match
    cl: '0',
  });
  const searchHtml = await getHtml(`${BASE}/search.php?${params}`);
  if (!searchHtml) return null;

  // Result rows are `.bdy > p.mid > a`; the page also has ranking/sidebar song
  // links (.sts/.h60) that must NOT be treated as matches — a no-result search
  // has no `.bdy .mid a`, so this correctly returns null instead of a wrong song.
  const href = parse(searchHtml)
    .querySelectorAll('.bdy .mid a')
    .map((a) => a.getAttribute('href'))
    .find((h) => h && /\/artist\/[a-zA-Z0-9]+\/[a-zA-Z0-9_]+\.html/.test(h));
  if (!href) return null;

  const pageHtml = await getHtml(href.startsWith('http') ? href : BASE + href);
  if (!pageHtml) return null;

  const box = parse(pageHtml).querySelector('#Lyric');
  if (!box) return null;
  const text = cleanLines(parse(box.innerHTML.replace(/<br\s*\/?>/gi, '\n')).text);
  return JAPANESE.test(text) ? text : null;
}
