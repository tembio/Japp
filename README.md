# 歌 Japp — Learn Japanese with Songs

Paste Japanese song lyrics (or search by title/artist) and get an AI-generated
study sheet: lyrics in kanji / kana / rōmaji, a vocabulary table, and the
grammar patterns used. Words and grammar are tracked across songs — when
something reappears in a new song, it's flagged so you know you've seen it
before.

## Setup

1. Get a free Gemini API key at https://aistudio.google.com/apikey
2. Copy `.env.example` to `.env` and paste your key in.
3. Install and run:

```sh
npm install
npm run dev
```

Open http://localhost:5173.

## How it works

- **Frontend**: React + Vite (`src/`), warm light theme.
- **Backend**: Express (`server/`) — keeps the API key off the browser,
  calls Gemini (`gemini-2.5-flash`), and persists analyzed songs to
  `data/songs.json`.
- **Lyrics search**: uses Gemini with Google Search grounding. Best effort —
  if it can't find the lyrics, paste them manually.
- **Repeat tracking**: each new song's vocabulary and grammar patterns are
  compared against all previously saved songs; matches are badged in the UI.
