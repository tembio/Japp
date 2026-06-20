import React, { useEffect, useRef, useState } from 'react';

const LOADING_STEPS = [
  'Sending the song to the AI…',
  'Reading the lyrics…',
  'Transcribing kanji, kana and rōmaji…',
  'Building the vocabulary tables…',
  'Spotting grammar patterns…',
  'Almost there…',
];

function Loader({ searching }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)),
      5000
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="loader">
      <div className="notes" aria-hidden="true">
        <span>♪</span>
        <span>♫</span>
        <span>♪</span>
        <span>♬</span>
      </div>
      <p className="loader-step" key={step}>
        {searching && step === 0 ? 'Searching the web for the lyrics…' : LOADING_STEPS[step]}
      </p>
      <p className="muted">This might take 15–60 seconds</p>
    </div>
  );
}
import { api } from './api.js';
import SongView from './SongView.jsx';
import Study from './Study.jsx';
import WordTip from './WordTip.jsx';

export default function App() {
  const [songs, setSongs] = useState([]);
  const [current, setCurrent] = useState(null);
  const [view, setView] = useState('mywords'); // 'intake' | 'songs' | 'mywords' | 'config' | 'song'
  const [myWords, setMyWords] = useState([]);
  const [showLearntWords, setShowLearntWords] = useState(false);
  const [expandedSongs, setExpandedSongs] = useState(() => new Set());
  const [openWordTip, setOpenWordTip] = useState(null);
  // Keys of My-words rows currently playing their exit animation before unmount.
  const [exitingWords, setExitingWords] = useState(() => new Set());
  const rowRefs = useRef({});

  const MAX_SONG_CHIPS = 5;
  const [mode, setMode] = useState('paste'); // 'paste' | 'search'
  const [lyrics, setLyrics] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [settings, setSettings] = useState(null);

  const refreshWords = () => api.myWords().then(setMyWords).catch(() => {});

  useEffect(() => {
    api.listSongs().then(setSongs).catch(() => {});
    api.getSettings().then(setSettings).catch(() => {});
    refreshWords();
  }, []);

  const [keyInputs, setKeyInputs] = useState({ deepseek: '' });
  const [keyNotice, setKeyNotice] = useState(null);

  async function saveKey(provider, value) {
    setKeyNotice(null);
    setError(null);
    try {
      await api.saveKey(provider, value);
      setKeyInputs((s) => ({ ...s, [provider]: '' }));
      setSettings(await api.getSettings());
      setKeyNotice(value ? 'Key saved.' : 'Key removed.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleWordSaved(key, makeSaved) {
    if (makeSaved) await api.addSaved(key).catch(() => {});
    else await api.removeSaved(key).catch(() => {});
    await refreshWords();
  }

  async function toggleWordLearnt(key, makeLearnt) {
    if (makeLearnt) await api.addLearnt(key).catch(() => {});
    else await api.removeLearnt(key).catch(() => {});
    await refreshWords();
  }

  // A My-words row disappears when, after the toggle, the word is no longer
  // both in the library (saved or learnt) and visible under the current filter.
  function willRowLeave(w, { saved = w.saved, learnt = w.learnt }) {
    const inLibrary = saved || learnt;
    const passesFilter = showLearntWords || !learnt;
    return !(inLibrary && passesFilter);
  }

  // Play the row's exit animation, then run the real toggle (which refreshes
  // the list and unmounts the row). The row's measured height is pinned as a
  // CSS var so it can collapse smoothly regardless of content.
  function animateRowOut(key, action) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      action();
      return;
    }
    const el = rowRefs.current[key];
    if (el) el.style.setProperty('--row-h', `${el.offsetHeight}px`);
    setExitingWords((prev) => new Set(prev).add(key));
    setTimeout(async () => {
      await action();
      setExitingWords((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 340);
  }

  function onRowSaved(w) {
    const makeSaved = !w.saved;
    if (willRowLeave(w, { saved: makeSaved })) animateRowOut(w.key, () => toggleWordSaved(w.key, makeSaved));
    else toggleWordSaved(w.key, makeSaved);
  }

  function onRowLearnt(w) {
    const makeLearnt = !w.learnt;
    if (willRowLeave(w, { learnt: makeLearnt })) animateRowOut(w.key, () => toggleWordLearnt(w.key, makeLearnt));
    else toggleWordLearnt(w.key, makeLearnt);
  }

  async function changeModel(model) {
    setSettings({ ...settings, model });
    try {
      await api.saveSettings({ model });
    } catch (err) {
      setError(err.message);
    }
  }

  async function analyze(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const payload =
        mode === 'paste' ? { lyrics, title, artist } : { title, artist };
      const song = await api.analyze(payload);
      setCurrent(song);
      setView('song');
      if (song.cached) {
        setNotice('Already in your library — loaded the saved analysis, no AI call needed.');
      } else {
        setSongs(await api.listSongs());
      }
      setLyrics('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const [focus, setFocus] = useState(null);
  const [backStack, setBackStack] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);

  async function openSong(id, focusTarget = null) {
    setError(null);
    setNotice(null);
    setBackStack([]);
    try {
      setCurrent(await api.getSong(id));
      setView('song');
      setFocus(focusTarget);
    } catch {
      setError('Could not open that song — it may have been deleted.');
    }
  }

  // Navigation from a "seen in" popup: remembers the origin (song + the
  // word's table row) so the floating back button can return there.
  async function openSeenIn(id, focusTarget) {
    setError(null);
    setNotice(null);
    try {
      const song = await api.getSong(id);
      const originFocus =
        focusTarget.kind === 'vocab' ? { kind: 'vocab-row', key: focusTarget.key } : focusTarget;
      setBackStack((st) => [...st, { id: current.id, title: current.title, focus: originFocus }]);
      setCurrent(song);
      setFocus(focusTarget);
    } catch {
      setError('Could not open that song — it may have been deleted.');
    }
  }

  // Navigation from a study-session hint: the session stays alive (the Study
  // component is kept mounted, just hidden) so the back button can return to it.
  async function openFromStudy(id, focusTarget) {
    setError(null);
    setNotice(null);
    try {
      const song = await api.getSong(id);
      setBackStack((st) => [...st, { study: true, title: 'study session' }]);
      setCurrent(song);
      setView('song');
      setFocus(focusTarget);
    } catch {
      setError('Could not open that song — it may have been deleted.');
    }
  }

  async function goBack() {
    const last = backStack[backStack.length - 1];
    setBackStack((st) => st.slice(0, -1));
    setError(null);
    setNotice(null);
    if (last.study) {
      setView('study');
      return;
    }
    try {
      setCurrent(await api.getSong(last.id));
      setFocus(last.focus ?? null);
    } catch {
      setError('Could not go back — that song may have been deleted.');
    }
  }

  async function removeSong(id) {
    await api.deleteSong(id);
    if (current?.id === id) setCurrent(null);
    setSongs(await api.listSongs());
  }

  return (
    <div className="layout">
      <header className="mobile-bar">
        <button className="hamburger" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
          ☰
        </button>
        <span className="mobile-title">
          <span className="logo-mark small">歌</span>
          Japp
        </span>
        <div className="mobile-bar-slot" id="mobile-bar-slot" />
      </header>
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <h1 className="logo">
          <span className="logo-mark">歌</span>
          <span className="logo-text">Japp</span>
        </h1>
        <p className="tagline">Learn Japanese with songs</p>
        <button
          className="new-btn"
          onClick={() => {
            setCurrent(null);
            setBackStack([]);
            setView('intake');
            setMenuOpen(false);
          }}
        >
          ＋ New song
        </button>
        <nav className="side-nav">
          <button
            className={`side-link ${view === 'songs' ? 'active' : ''}`}
            onClick={() => {
              setView('songs');
              setBackStack([]);
              setMenuOpen(false);
              api.listSongs().then(setSongs).catch(() => {});
            }}
          >
            Songs
            <span className="nav-count">{songs.length}</span>
          </button>
          <button
            className={`side-link ${view === 'mywords' ? 'active' : ''}`}
            onClick={() => {
              setView('mywords');
              setBackStack([]);
              setMenuOpen(false);
              refreshWords();
            }}
          >
            Words
            <span className="nav-count">{myWords.length}</span>
          </button>
          <button
            className={`side-link ${view === 'study' ? 'active' : ''}`}
            onClick={() => {
              setView('study');
              setBackStack([]);
              setMenuOpen(false);
            }}
          >
            Study
          </button>
          <button
            className={`side-link ${view === 'config' ? 'active' : ''}`}
            onClick={() => {
              setView('config');
              setBackStack([]);
              setMenuOpen(false);
            }}
          >
            Config
          </button>
        </nav>
      </aside>

      <main className="main">
        <div style={{ display: view === 'study' ? undefined : 'none' }}>
          <Study
            active={view === 'study'}
            onLearntChange={refreshWords}
            onSavedChange={refreshWords}
            onOpenSong={openFromStudy}
          />
        </div>
        {view === 'songs' ? (
          <div className="history-page tab-panel" key="songs">
            <h2>Songs</h2>
            {error && <p className="error">{error}</p>}
            {songs.length === 0 && (
              <p className="muted">No songs yet — analyze your first one!</p>
            )}
            <div className="songs-list">
              {songs.map((s, i) => (
                <div
                  key={s.id}
                  className="song-row"
                  style={{ animationDelay: `${Math.min(i, 12) * 0.05}s` }}
                  onClick={() => openSong(s.id)}
                >
                  <div className="song-row-main">
                    <span className="jp song-row-title">{s.title}</span>
                    {s.artist && <span className="jp song-row-artist">{s.artist}</span>}
                    <div className="song-row-meta">
                      {s.vocabCount} words · {s.grammarCount} grammar patterns
                    </div>
                  </div>
                  <button
                    className="delete-btn"
                    title="Delete"
                    aria-label="Delete song"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSong(s.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : view === 'mywords' ? (
          (() => {
            const shown = (showLearntWords ? myWords : myWords.filter((w) => !w.learnt))
              // unlearnt first, keeping the alphabetical order within each group
              .slice()
              .sort((a, b) => (a.learnt === b.learnt ? 0 : a.learnt ? 1 : -1));
            const learntCount = myWords.filter((w) => w.learnt).length;
            return (
              <div
                className="history-page tab-panel"
                key="mywords"
                onClick={() => setOpenWordTip(null)}
              >
                <div className="mywords-head">
                  <h2>Words</h2>
                  {myWords.length > 0 && (
                    <label className="romaji-toggle">
                      <input
                        type="checkbox"
                        checked={showLearntWords}
                        onChange={(e) => setShowLearntWords(e.target.checked)}
                      />
                      <span className="switch" aria-hidden="true" />
                      include learnt ({learntCount})
                    </label>
                  )}
                </div>
                {error && <p className="error">{error}</p>}
                {myWords.length === 0 && (
                  <p className="muted">
                    Nothing here yet — in a song's vocabulary table, tap ☆ to save a word or ✓ to
                    mark it learnt, and it'll show up here.
                  </p>
                )}
                {myWords.length > 0 && shown.length === 0 && (
                  <p className="muted">
                    All your words are marked as learnt. Flip “include learnt” to see them.
                  </p>
                )}
                <div className="learnt-list" key={showLearntWords ? 'all' : 'unlearnt'}>
                  {shown.map((w, i) => {
                    const exiting = exitingWords.has(w.key);
                    return (
                    <div
                      key={w.key}
                      ref={(el) => {
                        if (el) rowRefs.current[w.key] = el;
                        else delete rowRefs.current[w.key];
                      }}
                      className={`learnt-row ${w.learnt ? 'is-learnt' : ''} ${exiting ? 'exiting' : ''}`}
                      style={{ animationDelay: exiting ? '0s' : `${Math.min(i, 14) * 0.035}s` }}
                    >
                      <div className="lw-word-cell">
                        <WordTip
                          word={w.word}
                          reading={w.reading}
                          romaji={w.romaji}
                          meaning={w.meaning}
                          partOfSpeech={w.partOfSpeech}
                          id={w.key}
                          openId={openWordTip}
                          setOpenId={setOpenWordTip}
                        >
                          <span className="jp lw-word" title={w.partOfSpeech}>
                            {w.word}
                          </span>
                        </WordTip>
                        {w.reading && w.reading !== w.word && (
                          <span className="jp lw-reading">{w.reading}</span>
                        )}
                      </div>
                      <div className="lw-songs">
                        {w.songs.length === 0 ? (
                          <span className="muted">song no longer in library</span>
                        ) : (
                          <>
                            {(expandedSongs.has(w.key)
                              ? w.songs
                              : w.songs.slice(0, MAX_SONG_CHIPS)
                            ).map((s) => (
                              <button
                                key={s.id}
                                className="song-chip jp"
                                title={s.artist || undefined}
                                onClick={() => openSong(s.id, { kind: 'vocab', key: w.key })}
                              >
                                ♪ {s.title}
                              </button>
                            ))}
                            {w.songs.length > MAX_SONG_CHIPS && (
                              <button
                                className="song-chip more"
                                onClick={() =>
                                  setExpandedSongs((prev) => {
                                    const next = new Set(prev);
                                    next.has(w.key) ? next.delete(w.key) : next.add(w.key);
                                    return next;
                                  })
                                }
                              >
                                {expandedSongs.has(w.key)
                                  ? 'show less'
                                  : `+${w.songs.length - MAX_SONG_CHIPS} more`}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <div className="lw-meaning">{w.meaning || '—'}</div>
                      <div className="lw-actions">
                        <button
                          className={`save-btn ${w.saved ? 'on' : ''}`}
                          title={w.saved ? 'Remove from saved' : 'Save'}
                          onClick={() => onRowSaved(w)}
                        >
                          {w.saved ? '★' : '☆'}
                        </button>
                        <button
                          className={`learn-btn ${w.learnt ? 'on' : ''}`}
                          title={w.learnt ? 'Mark as not learnt' : 'Mark as learnt'}
                          onClick={() => onRowLearnt(w)}
                        >
                          ✓
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            );
          })()
        ) : view === 'config' ? (
          <div className="history-page tab-panel" key="config">
            <h2>Config</h2>
            {error && <p className="error">{error}</p>}
            <section className="config-section">
              <h3>AI model</h3>
              <p className="muted">
                Used to analyze lyrics. Searching by title scrapes j-lyric.net / utaten.com for
                Japanese titles, or lyricstranslate.com for romaji — no key needed.
              </p>
              {settings &&
                [...new Set(settings.models.map((m) => m.provider))].map((provider) => (
                  <div key={provider} className="model-group">
                    <h4>{settings.providerLabels?.[provider] ?? provider}</h4>
                    <div className="model-options">
                      {settings.models
                        .filter((m) => m.provider === provider)
                        .map((m) => {
                          const [name, hint] = m.label.split(' — ');
                          const active = settings.model === m.id;
                          return (
                            <button
                              key={m.id}
                              className={`model-option ${active ? 'active' : ''}`}
                              onClick={() => changeModel(m.id)}
                            >
                              <span className="mo-radio" aria-hidden="true" />
                              <span className="mo-text">
                                <span className="mo-name">{name}</span>
                                {hint && <span className="mo-hint">{hint}</span>}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
            </section>
            <section className="config-section">
              <h3>API keys</h3>
              {keyNotice && <p className="notice">{keyNotice}</p>}
              {settings &&
                [
                  { id: 'deepseek', name: 'DeepSeek', url: 'platform.deepseek.com' },
                ].map((p) => {
                  const meta = settings.keys?.[p.id];
                  return (
                    <div key={p.id} className="key-row">
                      <div className="key-info">
                        <span className="key-name">{p.name}</span>
                        {!meta?.set && (
                          <span className="key-status">not set — get one at {p.url}</span>
                        )}
                      </div>
                      <input
                        type="password"
                        placeholder="Paste API key"
                        autoComplete="off"
                        value={keyInputs[p.id]}
                        onChange={(e) =>
                          setKeyInputs((s) => ({ ...s, [p.id]: e.target.value }))
                        }
                      />
                      <button
                        className="key-btn"
                        disabled={!keyInputs[p.id].trim()}
                        onClick={() => saveKey(p.id, keyInputs[p.id].trim())}
                      >
                        Save
                      </button>
                      {meta?.source === 'ui' && (
                        <button
                          className="key-btn remove"
                          title="Remove this key (falls back to .env if set there)"
                          onClick={() => saveKey(p.id, '')}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
            </section>
          </div>
        ) : view === 'song' && current ? (
          <>
            {notice && <p className="notice">{notice}</p>}
            {error && <p className="error">{error}</p>}
            <SongView
              song={current}
              focus={focus}
              onNavigate={openSeenIn}
              clearFocus={() => setFocus(null)}
              onLearntChange={refreshWords}
              onSavedChange={refreshWords}
            />
            {backStack.length > 0 && (
              <button className="back-btn" onClick={goBack}>
                ← Back to {backStack[backStack.length - 1].title}
              </button>
            )}
          </>
        ) : view === 'study' ? null : (
          <div className="intake">
            <h2>Analyze a song</h2>
            {loading ? (
              <Loader searching={mode === 'search'} />
            ) : (
              <>
            <div className="mode-tabs">
              <button
                className={mode === 'paste' ? 'active' : ''}
                onClick={() => setMode('paste')}
              >
                Paste lyrics
              </button>
              <button
                className={mode === 'search' ? 'active' : ''}
                onClick={() => setMode('search')}
              >
                Search by title
              </button>
            </div>
            <form onSubmit={analyze}>
              <div className="row">
                <input
                  placeholder="Song title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
                <input
                  placeholder="Artist (optional)"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                />
              </div>
              {mode === 'paste' && (
                <textarea
                  placeholder="Paste the Japanese lyrics here…"
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  rows={12}
                  required
                />
              )}
              {mode === 'search' && (
                <p className="muted">
                  Lyrics are looked up on j-lyric.net / utaten.com (Japanese titles) or
                  lyricstranslate.com (romaji). The analysis itself uses your selected model. If
                  the lyrics can't be found, paste them instead.
                </p>
              )}
              <button className="analyze-btn" disabled={loading}>
                Analyze
              </button>
              {error && <p className="error">{error}</p>}
            </form>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
