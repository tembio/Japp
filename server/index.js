import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findLyrics, analyzeLyrics } from './ai.js';
import { logError } from './logger.js';
import { getSettings, saveSettings, apiKeyMeta, exportData } from './store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // no .env yet — the API key check in gemini.js reports it clearly
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// The PWA is hosted on a different origin than this AI proxy, so allow CORS.
// Set CORS_ORIGIN to the front-end URL in production; defaults to '*'.
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Live API-key status for the Config screen (never sends the raw keys).
app.get('/api/keymeta', (req, res) => {
  res.json({ gemini: apiKeyMeta('gemini'), deepseek: apiKeyMeta('deepseek') });
});

app.put('/api/keys', (req, res) => {
  const { provider, key } = req.body ?? {};
  if (!['gemini', 'deepseek'].includes(provider)) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }
  const settings = getSettings();
  const keys = { ...settings.keys };
  if (key?.trim()) keys[provider] = key.trim();
  else delete keys[provider];
  saveSettings({ ...settings, keys });
  res.json(apiKeyMeta(provider));
});

// One-time dump of the legacy file-backed library so a fresh client can seed
// its on-device IndexedDB without losing existing data.
app.get('/api/export', (req, res) => {
  res.json(exportData());
});

// Stateless: the client owns the library now, so this only runs the AI and
// returns the analysis. The model is chosen on the client and passed in.
app.post('/api/analyze', async (req, res) => {
  const { lyrics, title, artist, model } = req.body ?? {};
  try {
    if (!title?.trim()) {
      return res.status(400).json({ error: 'Please provide the song title.' });
    }
    let text = (lyrics ?? '').trim();
    if (!text) {
      text = await findLyrics(title.trim(), artist?.trim(), model);
    }
    const analysis = await analyzeLyrics(text, { title: title?.trim(), artist: artist?.trim() }, model);
    res.json(analysis);
  } catch (err) {
    if (err.expose) {
      res.status(err.status ?? 500).json({ error: err.message });
    } else {
      logError('POST /api/analyze', err);
      res.status(500).json({
        error: 'Something went wrong while analyzing the song. Please try again.',
      });
    }
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`API server on http://localhost:${PORT}`));
