import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { findLyrics, analyzeLyrics } from './ai.js';
import { logError } from './logger.js';
import {
  listSongs,
  getSong,
  deleteSong,
  addSong,
  findExisting,
  getSettings,
  saveSettings,
  getLearnt,
  addLearnt,
  removeLearnt,
  getSaved,
  addSaved,
  removeSaved,
  myWords,
  apiKeyMeta,
  allVocab,
} from './store.js';
import { MODELS, PROVIDER_LABELS } from './models.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // no .env yet — the API key check in gemini.js reports it clearly
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/settings', (req, res) => {
  const { keys, ...rest } = getSettings(); // never send raw keys to the browser
  res.json({
    ...rest,
    models: MODELS,
    providerLabels: PROVIDER_LABELS,
    keys: { gemini: apiKeyMeta('gemini'), deepseek: apiKeyMeta('deepseek') },
  });
});

app.put('/api/settings', (req, res) => {
  const { model } = req.body ?? {};
  if (!MODELS.some((m) => m.id === model)) {
    return res.status(400).json({ error: `Unknown model: ${model}` });
  }
  const saved = saveSettings({ ...getSettings(), model });
  res.json({ model: saved.model });
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

app.get('/api/learnt', (req, res) => {
  res.json(getLearnt());
});

app.post('/api/learnt', (req, res) => {
  const { word } = req.body ?? {};
  if (!word?.trim()) return res.status(400).json({ error: 'Provide a word.' });
  res.json(addLearnt(word));
});

app.delete('/api/learnt/:word', (req, res) => {
  res.json(removeLearnt(req.params.word));
});

app.get('/api/saved', (req, res) => {
  res.json(getSaved());
});

app.get('/api/mywords', (req, res) => {
  res.json(myWords());
});

app.post('/api/saved', (req, res) => {
  const { word } = req.body ?? {};
  if (!word?.trim()) return res.status(400).json({ error: 'Provide a word.' });
  res.json(addSaved(word));
});

app.delete('/api/saved/:word', (req, res) => {
  res.json(removeSaved(req.params.word));
});

app.get('/api/vocab', (req, res) => {
  res.json(allVocab());
});

app.get('/api/songs', (req, res) => {
  res.json(listSongs());
});

app.get('/api/songs/:id', (req, res) => {
  const song = getSong(req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  res.json(song);
});

app.delete('/api/songs/:id', (req, res) => {
  if (!deleteSong(req.params.id)) return res.status(404).json({ error: 'Song not found' });
  res.json({ ok: true });
});

app.post('/api/analyze', async (req, res) => {
  const { lyrics, title, artist } = req.body ?? {};
  try {
    if (!title?.trim()) {
      return res.status(400).json({ error: 'Please provide the song title.' });
    }
    let text = (lyrics ?? '').trim();

    const lyricsKey = text ? fingerprint(text) : undefined;
    const existing = findExisting({ title, artist, lyricsKey });
    if (existing) {
      return res.json({ ...existing, cached: true });
    }

    if (!text) {
      text = await findLyrics(title.trim(), artist?.trim());
    }
    const analysis = await analyzeLyrics(text, { title: title?.trim(), artist: artist?.trim() });
    const song = addSong(analysis, {
      query: title?.trim() ? { title: title.trim(), artist: artist?.trim() || undefined } : undefined,
      lyricsKey: lyricsKey ?? fingerprint(text),
      model: getSettings().model,
    });
    res.json(song);
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

function fingerprint(text) {
  const normalized = text.replace(/\s+/g, '').toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`API server on http://localhost:${PORT}`));
