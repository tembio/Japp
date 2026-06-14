import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { vocabGroup, VOCAB_GROUP_ORDER } from './SongView.jsx';

const SESSION_SIZES = ['5', '10', '15', '20', '30', 'all'];

// The setup options persist across navigation and page reloads.
const SETUP_STORAGE_KEY = 'japp.study.setup';
function loadSetup() {
  try {
    return JSON.parse(localStorage.getItem(SETUP_STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function SongSelect({ songs, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = value === 'all' ? null : songs.find((s) => s.id === value);

  function pick(id) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div className="song-select" ref={ref}>
      <button className={`ss-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        {selected ? (
          <span className="ss-label jp">
            {selected.title}
            {selected.artist && <span className="ss-trigger-artist">{selected.artist}</span>}
          </span>
        ) : (
          <span className="ss-label">All songs</span>
        )}
        <span className={`ss-chevron ${open ? 'up' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="ss-menu">
          <button className={`ss-option ${value === 'all' ? 'active' : ''}`} onClick={() => pick('all')}>
            <span className="ss-title">All songs</span>
            <span className="ss-sub">
              {songs.length} song{songs.length !== 1 ? 's' : ''} in your library
            </span>
          </button>
          {songs.map((s) => (
            <button
              key={s.id}
              className={`ss-option ${value === s.id ? 'active' : ''}`}
              onClick={() => pick(s.id)}
            >
              <span className="ss-title jp">{s.title}</span>
              <span className="ss-sub">
                {s.artist ? `${s.artist} · ` : ''}
                {s.vocabCount} words
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Study({ active, onLearntChange, onOpenSong }) {
  const [vocab, setVocab] = useState(null);
  const [songs, setSongs] = useState([]);
  const [learnt, setLearnt] = useState(() => new Set());
  const [saved, setSaved] = useState(() => new Set());

  // setup — initialised from the last-used options saved in localStorage
  const [savedSetup] = useState(loadSetup);
  const [source, setSource] = useState(savedSetup.source ?? 'all'); // 'all' | 'mywords' (saved or learnt)
  const [types, setTypes] = useState(() => new Set(savedSetup.types ?? VOCAB_GROUP_ORDER));
  const [songId, setSongId] = useState(savedSetup.songId ?? 'all');
  const [includeLearnt, setIncludeLearnt] = useState(savedSetup.includeLearnt ?? false);
  const [hintsEnabled, setHintsEnabled] = useState(savedSetup.hintsEnabled ?? true);
  const [showRomaji, setShowRomaji] = useState(savedSetup.showRomaji ?? false);
  const [size, setSize] = useState(savedSetup.size ?? '10');

  // Persist the setup options whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(
        SETUP_STORAGE_KEY,
        JSON.stringify({ source, types: [...types], songId, includeLearnt, hintsEnabled, showRomaji, size })
      );
    } catch {
      // ignore (private mode / quota)
    }
  }, [source, types, songId, includeLearnt, hintsEnabled, showRomaji, size]);

  // session
  const [phase, setPhase] = useState('setup'); // 'setup' | 'session' | 'summary'
  const [cards, setCards] = useState([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [hintShown, setHintShown] = useState(false);
  const [cardRomaji, setCardRomaji] = useState(false);
  const [results, setResults] = useState([]);
  const [drag, setDrag] = useState(null); // { startX, dx }
  const [exiting, setExiting] = useState(null); // 'left' | 'right'
  const draggedRef = useRef(false); // suppresses the click-to-reveal after a real drag

  // The component stays mounted while navigating elsewhere (so a running
  // session survives); refresh data whenever it becomes visible in setup.
  useEffect(() => {
    if (!active || phase !== 'setup') return;
    api.allVocab().then(setVocab).catch(() => setVocab([]));
    api.listSongs().then(setSongs).catch(() => {});
    api.getLearnt().then((ws) => setLearnt(new Set(ws))).catch(() => {});
    api.getSaved().then((ws) => setSaved(new Set(ws))).catch(() => {});
  }, [active]);

  const pool = useMemo(() => {
    if (!vocab) return [];
    return vocab.filter(
      (v) =>
        types.has(vocabGroup(v.partOfSpeech)) &&
        (songId === 'all' || v.songs.some((s) => s.id === songId)) &&
        (source === 'all' || saved.has(v.key) || learnt.has(v.key)) &&
        (includeLearnt || !learnt.has(v.key))
    );
  }, [vocab, types, songId, source, saved, includeLearnt, learnt]);

  function toggleType(group) {
    setTypes((prev) => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  }

  function toggleLearnt(key) {
    const next = new Set(learnt);
    if (next.has(key)) {
      next.delete(key);
      api.removeLearnt(key).then(onLearntChange).catch(() => {});
    } else {
      next.add(key);
      api.addLearnt(key).then(onLearntChange).catch(() => {});
    }
    setLearnt(next);
  }

  function start(customCards) {
    const selected =
      customCards ?? shuffle(pool).slice(0, size === 'all' ? pool.length : Number(size));
    setCards(selected);
    setIdx(0);
    setRevealed(false);
    setHintShown(false);
    setCardRomaji(false);
    setResults([]);
    setPhase('session');
  }

  function answer(correct) {
    const next = [...results, { card: cards[idx], correct }];
    setResults(next);
    if (idx + 1 >= cards.length) {
      setPhase('summary');
    } else {
      setIdx(idx + 1);
      setRevealed(false);
      setHintShown(false);
      setCardRomaji(false);
    }
  }

  const SWIPE_THRESHOLD = 90;

  function onSwipeEnd() {
    if (!drag) return;
    const dx = drag.dx;
    setDrag(null);
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      const dir = dx > 0 ? 'right' : 'left';
      setExiting(dir);
      setTimeout(() => {
        setExiting(null);
        answer(dir === 'right');
      }, 220);
    }
  }

  /* ---------- setup ---------- */
  if (phase === 'setup') {
    return (
      <div className="history-page study-page">
        <h2>Study</h2>
        <section className="config-section">
          <h3>Words</h3>
          <div className="type-chips">
            <button
              className={`type-chip ${source === 'all' ? 'active' : ''}`}
              onClick={() => setSource('all')}
            >
              All words
            </button>
            <button
              className={`type-chip ${source === 'mywords' ? 'active' : ''}`}
              onClick={() => setSource('mywords')}
            >
              My words
            </button>
          </div>

          <h3>Word types</h3>
          <div className="type-chips">
            {VOCAB_GROUP_ORDER.map((g) => (
              <button
                key={g}
                className={`type-chip ${types.has(g) ? 'active' : ''}`}
                onClick={() => toggleType(g)}
              >
                {g}
              </button>
            ))}
          </div>

          <h3>Song</h3>
          <SongSelect songs={songs} value={songId} onChange={setSongId} />

          <h3>Options</h3>
          <div className="study-options">
            <label className="romaji-toggle">
              <input
                type="checkbox"
                checked={includeLearnt}
                onChange={(e) => setIncludeLearnt(e.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
              include learnt words
            </label>
            <label className="romaji-toggle">
              <input
                type="checkbox"
                checked={showRomaji}
                onChange={(e) => setShowRomaji(e.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
              show rōmaji
            </label>
            <label className="romaji-toggle">
              <input
                type="checkbox"
                checked={hintsEnabled}
                onChange={(e) => setHintsEnabled(e.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
              lyric-line hints
            </label>
          </div>

          <h3>Words per session</h3>
          <div className="type-chips">
            {SESSION_SIZES.map((s) => (
              <button
                key={s}
                className={`type-chip ${size === s ? 'active' : ''}`}
                onClick={() => setSize(s)}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>

          <p className="muted pool-info">
            {vocab === null ? 'Loading vocabulary…' : `${pool.length} words match your filters.`}
          </p>
          <button className="analyze-btn" disabled={pool.length === 0} onClick={() => start()}>
            Start session
          </button>
        </section>
      </div>
    );
  }

  /* ---------- session ---------- */
  if (phase === 'session') {
    const card = cards[idx];
    const isLearnt = learnt.has(card.key);
    const hasExample = Boolean(card.example);
    // The pre-reveal hint button is opt-in; after reveal the example line
    // always shows as context.
    const showHintButton = hintsEnabled && hasExample;
    // Words written purely in kanji get their kana reading shown upfront.
    const kanjiOnly = !/[぀-ヿ]/.test(card.word) && /[一-鿿]/.test(card.word);
    return (
      <div className="history-page study-page study-session">
        <div className="study-top">
          <span className="study-progress-label">
            {idx + 1} / {cards.length}
          </span>
          <button className="study-quit" onClick={() => setPhase('setup')}>
            End session
          </button>
        </div>
        <div className="study-progress">
          <div className="study-progress-fill" style={{ width: `${(idx / cards.length) * 100}%` }} />
        </div>

        <div className="swipe-hint">
          <span className="sh-cue sh-miss">
            <span className="sh-arrow">←</span> swipe left: still learning
          </span>
          <span className="sh-cue sh-hit">
            swipe right: got it <span className="sh-arrow">→</span>
          </span>
        </div>

        <div
          className={`study-card ${revealed ? 'revealed' : ''}`}
          style={
            exiting
              ? {
                  transform: `translateX(${exiting === 'right' ? 640 : -640}px) rotate(${exiting === 'right' ? 18 : -18}deg)`,
                  opacity: 0,
                  transition: 'transform 0.22s ease, opacity 0.22s ease',
                }
              : drag
                ? {
                    transform: `translateX(${drag.dx}px) rotate(${drag.dx / 22}deg)`,
                    transition: 'none',
                  }
                : { transition: 'transform 0.2s ease' }
          }
          onClick={() => {
            if (draggedRef.current) {
              draggedRef.current = false;
              return;
            }
            if (revealed) return;
            setRevealed(true);
            if (hasExample) setHintShown(true);
          }}
          onPointerDown={(e) => {
            if (exiting) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            draggedRef.current = false;
            setDrag({ startX: e.clientX, dx: 0 });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const dx = e.clientX - drag.startX;
            if (Math.abs(dx) > 8) draggedRef.current = true;
            setDrag({ ...drag, dx });
          }}
          onPointerUp={onSwipeEnd}
          onPointerCancel={() => setDrag(null)}
        >
          <span
            className="swipe-badge hit"
            style={{
              opacity: exiting === 'right' ? 1 : Math.max(0, Math.min((drag?.dx ?? 0) / SWIPE_THRESHOLD, 1)),
            }}
          >
            ✓ Got it
          </span>
          <span
            className="swipe-badge miss"
            style={{
              opacity: exiting === 'left' ? 1 : Math.max(0, Math.min(-(drag?.dx ?? 0) / SWIPE_THRESHOLD, 1)),
            }}
          >
            ✗ Still learning
          </span>
          <span className="jp study-word">{card.word}</span>
          {kanjiOnly && <span className="jp study-kana-front">{card.reading}</span>}
          {(showRomaji || cardRomaji) && <span className="study-romaji">{card.romaji}</span>}
          {revealed && (
            <div className="study-answer">
              {card.reading !== card.word && !kanjiOnly && (
                <span className="jp study-reading">{card.reading}</span>
              )}
              <span className="study-meaning">{card.meaning}</span>
            </div>
          )}
        </div>
        <div className="card-controls">
          <button
            className={`learnt-control ${isLearnt ? 'on' : ''}`}
            onClick={() => toggleLearnt(card.key)}
          >
            <span className={`learn-dot ${isLearnt ? 'on' : ''}`}>✓</span>
            {isLearnt ? 'learnt' : 'mark as learnt'}
          </button>
          {!showRomaji && (
            <label className="romaji-toggle">
              <input
                type="checkbox"
                checked={cardRomaji}
                onChange={(e) => setCardRomaji(e.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
              rōmaji
            </label>
          )}
        </div>

        {!revealed && <p className="muted tap-hint">tap the card to reveal the meaning</p>}
        {!revealed && showHintButton && !hintShown && (
          <button className="hint-btn" onClick={() => setHintShown(true)}>
            Show hint
          </button>
        )}
        {hintShown && hasExample && (
          <div className="hint-box">
            <span className="jp hint-line">{card.example.line}</span>
            {card.example.kana && card.example.kana !== card.example.line && (
              <span className="jp hint-kana">{card.example.kana}</span>
            )}
            <span className="hint-song">♪ {card.example.title}</span>
            <button
              className="hint-goto"
              title="Open in song"
              onClick={() => onOpenSong(card.example.songId, { kind: 'vocab', key: card.key })}
            >
              ↗
            </button>
          </div>
        )}

      </div>
    );
  }

  /* ---------- summary ---------- */
  const correct = results.filter((r) => r.correct);
  const missed = results.filter((r) => !r.correct);
  return (
    <div className="history-page study-page">
      <h2>Session complete</h2>
      <p className="study-score">
        You got <strong>{correct.length}</strong> of <strong>{results.length}</strong> right
        {results.length > 0 && ` (${Math.round((correct.length / results.length) * 100)}%)`}.
      </p>

      {missed.length > 0 && (
        <section className="config-section">
          <h3>Still learning ({missed.length})</h3>
          <div className="summary-list">
            {missed.map(({ card }) => (
              <div key={card.key} className="summary-row">
                <span className="jp lw-word">{card.word}</span>
                <span className="jp lw-reading">{card.reading}</span>
                <span className="lw-meaning">{card.meaning}</span>
                <button
                  className={`learn-btn ${learnt.has(card.key) ? 'on' : ''}`}
                  title={learnt.has(card.key) ? 'Mark as not learnt' : 'Mark as learnt'}
                  onClick={() => toggleLearnt(card.key)}
                >
                  ✓
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {correct.length > 0 && (
        <section className="config-section">
          <h3>Got it ({correct.length})</h3>
          <div className="summary-list">
            {correct.map(({ card }) => (
              <div key={card.key} className="summary-row hit">
                <span className="jp lw-word">{card.word}</span>
                <span className="jp lw-reading">{card.reading}</span>
                <span className="lw-meaning">{card.meaning}</span>
                <button
                  className={`learn-btn ${learnt.has(card.key) ? 'on' : ''}`}
                  title={learnt.has(card.key) ? 'Mark as not learnt' : 'Mark as learnt'}
                  onClick={() => toggleLearnt(card.key)}
                >
                  ✓
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="answer-btns summary-actions">
        {missed.length > 0 && (
          <button className="answer-btn miss" onClick={() => start(shuffle(missed.map((r) => r.card)))}>
            Retry missed words
          </button>
        )}
        <button className="answer-btn hit" onClick={() => setPhase('setup')}>
          New session
        </button>
      </div>
    </div>
  );
}
