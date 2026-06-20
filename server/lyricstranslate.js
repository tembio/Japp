import { parse } from 'node-html-parser';
import { getHtml, JAPANESE, cleanLines } from './scrape.js';

const BASE = 'https://lyricstranslate.com';

// Lyrics source for romaji / Latin-script input (j-lyric.net and utaten.com are
// indexed by Japanese text and won't match romaji). lyricstranslate.com is
// searchable by romanized name and hosts the original Japanese lyrics.
export async function findLyrics(title, artist) {
  const query = [title, artist].filter(Boolean).join(' ').trim();
  if (!query) return null;
  const searchHtml = await getHtml(`${BASE}/en/site-search?query=${encodeURIComponent(query)}`);
  if (!searchHtml) return null;

  // Results mix artists and songs; pick the song link whose URL slug matches the
  // most query tokens (an artist-only link matches just the artist, if that).
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  let bestHref = null;
  let bestScore = 1; // require at least 2 matching tokens to avoid false hits
  for (const a of parse(searchHtml).querySelectorAll('.block-search-res__item a')) {
    const href = a.getAttribute('href');
    if (!href || !/-lyrics\.html$/.test(href)) continue;
    const slug = href.toLowerCase();
    const score = tokens.filter((t) => slug.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestHref = href;
    }
  }
  if (!bestHref) return null;

  const pageHtml = await getHtml(bestHref.startsWith('http') ? bestHref : BASE + bestHref);
  if (!pageHtml) return null;

  // .ltf holds the original lyrics; line breaks come from <br> and block ends.
  const box = parse(pageHtml).querySelector('.ltf');
  if (!box) return null;
  const html = box.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n');
  const text = cleanLines(parse(html).text);
  return JAPANESE.test(text) ? text : null;
}
