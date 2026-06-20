# 歌 Japp — Learn Japanese with Songs

Paste Japanese song lyrics (or search by title/artist) and get an AI-generated
study sheet: lyrics in kanji / kana / rōmaji, a vocabulary table, and the
grammar patterns used. Words and grammar are tracked across songs — when
something reappears in a new song, it's flagged so you know you've seen it
before.

## Setup

1. Get a DeepSeek API key (5M free signup tokens) at https://platform.deepseek.com.
2. Copy `.env.example` to `.env` and paste your key in.
3. Install and run:

```sh
npm install
npm run dev
```

Open http://localhost:5173.

## How it works

- **Frontend**: React + Vite (`src/`), installable PWA.
- **On-device data**: your library, saved/learnt words and model choice live in
  the browser (IndexedDB, `src/store.js`). Everything except analyzing a new
  song works **offline**.
- **Thin backend**: Express (`server/`) is now only an AI proxy — it keeps the
  API key off the browser, calls DeepSeek for analysis, and scrapes
  j-lyric.net / utaten.com for lyrics. It no longer stores data.
- **Lyrics search**: scrapes j-lyric.net (then utaten.com as fallback) — plain
  HTML, no API key. Best effort — if neither has the song, paste the lyrics
  manually.
- **Repeat tracking**: each new song's vocabulary and grammar patterns are
  compared against everything already in your library; matches are badged.
- **First launch** pulls any existing server library (`GET /api/export`) into
  IndexedDB once, so nothing is lost.

## Offline / installing as a mobile app

The app is a PWA: open it in a browser and "Add to Home Screen". After the
first online load it runs offline; only "analyze a new song" needs internet.

### Deploying

The static front-end and the AI server can be hosted separately:

- **Front-end** (Netlify/Vercel/GitHub Pages): `npm run build`, deploy `dist/`.
  If the server is on another origin, set `VITE_API_BASE` to its URL at build
  time, e.g. `VITE_API_BASE=https://api.japp.example.com npm run build`.
- **AI server** (Render/Fly/Railway): run `npm start` with `DEEPSEEK_API_KEY`
  set, plus `CORS_ORIGIN` = your front-end URL.

### Locking it down (private deployment)

Set **`APP_PASSWORD`** on the server to make the app private. The app then shows
a password screen, and the AI/keys endpoints reject any request without the
matching password — so a stranger who finds the URL can't burn your API quota.
The password is entered once per device and remembered (offline included).
Leave `APP_PASSWORD` unset for an open local instance.

Or host both from one origin: `npm run build` then `npm start` serves `dist/`
and `/api` together (leave `VITE_API_BASE` unset).
