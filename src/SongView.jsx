import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.js';

const normWord = (w) => (w ?? '').trim().replace(/\s+/g, '');

// Finds the first lyric line containing the word. Vocabulary words are
// dictionary forms while lyrics may conjugate them (思い出す → 思い出した),
// so on no exact match the word is shortened from the end, down to 2 chars.
function findLineForWord(lines, word) {
  if (!word) return -1;
  for (let len = word.length; len >= Math.min(word.length, 2); len--) {
    const fragment = word.slice(0, len);
    const idx = lines.findIndex((l) => l.kanji?.includes(fragment));
    if (idx !== -1) return idx;
  }
  return -1;
}

export const VOCAB_GROUP_ORDER = ['Nouns', 'Verbs', 'Adjectives', 'Adverbs', 'Expressions', 'Other'];

// On hover-capable devices (desktop) tooltips are pure CSS hover; tap-to-open
// is only for touch screens. Evaluated live so devtools mobile emulation and
// convertible devices are detected correctly.
const isTouch = () => window.matchMedia('(hover: none)').matches;

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// partOfSpeech is free text from the AI ("verb (ichidan)", "na-adjective"…);
// order matters: "adverb" contains "verb", "pronoun" contains "noun".
export function vocabGroup(partOfSpeech = '') {
  const p = partOfSpeech.toLowerCase();
  if (/expression|idiom|phrase|interjection|onomatopoei/.test(p)) return 'Expressions';
  if (p.includes('adverb')) return 'Adverbs';
  if (p.includes('adject')) return 'Adjectives';
  if (p.includes('verb')) return 'Verbs';
  if (p.includes('noun')) return 'Nouns';
  return 'Other';
}

// Splits the displayed line into plain text and interactive word spans by
// walking the AI's word segmentation in order. Tokens that can't be located
// in the text (model mismatch) degrade to plain text.
function LineText({ line, script, lineIdx, openId, setOpenId, onHold }) {
  const text = line[script] ?? '';
  const field = script === 'kana' ? 'reading' : script === 'romaji' ? 'romaji' : 'word';
  const tokens = (line.words ?? []).filter((t) => t[field]?.trim());
  const hay = script === 'romaji' ? text.toLowerCase() : text;
  const find = (surface, from) =>
    hay.indexOf(script === 'romaji' ? surface.toLowerCase() : surface, from);

  // Align each word to the line, in order. A word that matches the line text
  // verbatim takes its exact span; one that doesn't (e.g. DeepSeek returned a
  // dictionary form instead of the conjugated surface) still claims the line
  // text up to where the next word matches — so it stays clickable instead of
  // being dropped to plain, non-interactive text.
  const parts = [];
  let pos = 0;
  let j = 0;
  while (j < tokens.length) {
    const token = tokens[j];
    const idx = find(token[field], pos);
    if (idx !== -1) {
      if (idx > pos) parts.push(text.slice(pos, idx));
      const end = idx + token[field].length;
      parts.push({ token, surface: text.slice(idx, end), id: `${lineIdx}-${j}` });
      pos = end;
      j++;
    } else {
      // No verbatim match: give this word the gap up to the next word that does
      // match (folding any other non-matching words in between into that span).
      let n = j + 1;
      let nextIdx = -1;
      while (n < tokens.length && (nextIdx = find(tokens[n][field], pos)) === -1) n++;
      const end = nextIdx === -1 ? text.length : nextIdx;
      if (end > pos) {
        parts.push({ token, surface: text.slice(pos, end), id: `${lineIdx}-${j}` });
        pos = end;
      }
      j = n;
    }
  }
  if (pos < text.length) parts.push(text.slice(pos));

  return parts.map((part, k) => {
    if (typeof part === 'string') return part;
    const { token, surface, id } = part;
    return (
      <Token key={k} token={token} surface={surface} id={id} openId={openId} setOpenId={setOpenId} onHold={onHold} />
    );
  });
}

function Token({ token, surface, id, openId, setOpenId, onHold }) {
  const ref = useRef(null);
  const [shift, setShift] = useState(0);
  const [below, setBelow] = useState(false);
  const holdTimer = useRef(null);
  const held = useRef(false);

  // Long-press (~500ms) jumps to the word's vocab row; a normal tap still opens
  // the tooltip. `held` suppresses the tap that fires after a long-press.
  function startHold() {
    held.current = false;
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      held.current = true;
      onHold?.(token.word, id);
    }, 500);
  }
  function endHold() {
    clearTimeout(holdTimer.current);
  }

  // The tip is centered on the word; once visible, measure it and nudge it
  // horizontally so it never overflows the viewport, and flip it below the
  // word when there isn't room above (e.g. the first line).
  function clampTip() {
    requestAnimationFrame(() => {
      const tip = ref.current?.querySelector('.tip');
      if (!tip) return;
      const rect = tip.getBoundingClientRect();
      if (!rect.width) return;
      const margin = 8;
      const vw = document.documentElement.clientWidth;
      let delta = 0;
      if (rect.left < margin) delta = margin - rect.left;
      else if (rect.right > vw - margin) delta = vw - margin - rect.right;
      if (delta) setShift((prev) => prev + delta);
      const wordRect = ref.current.getBoundingClientRect();
      setBelow(wordRect.top - rect.height - 10 < margin);
    });
  }

  return (
    <span
      ref={ref}
      className={`token ${openId === id ? 'open' : ''}`}
      onMouseEnter={clampTip}
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (held.current) {
          held.current = false;
          e.stopPropagation();
          return;
        }
        if (!isTouch()) return;
        e.stopPropagation();
        setOpenId(openId === id ? null : id);
        clampTip();
      }}
    >
      {surface}
      <span
        className={`tip ${below ? 'below' : ''}`}
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
      >
        <span className="tip-inner">
          <span className="tip-word jp">{token.word}</span>
          {token.reading && token.reading !== token.word && (
            <span className="tip-reading jp">{token.reading}</span>
          )}
          <span className="tip-romaji">{token.romaji}</span>
          <span className="tip-divider" />
          <span className="tip-meaning">{token.meaning}</span>
        </span>
      </span>
    </span>
  );
}

export default function SongView({
  song,
  focus,
  onNavigate,
  clearFocus,
  onLearntChange,
  onSavedChange,
}) {
  const [script, setScript] = useState('kanji');
  const [showRomaji, setShowRomaji] = useState(
    () => localStorage.getItem('showRomaji') !== 'false'
  );
  const [showTranslation, setShowTranslation] = useState(
    () => localStorage.getItem('showTranslation') !== 'false'
  );
  const [openTokenId, setOpenTokenId] = useState(null);
  const [learnt, setLearnt] = useState(() => new Set());
  const [saved, setSaved] = useState(() => new Set());
  const [showLearnt, setShowLearnt] = useState(
    () => localStorage.getItem('showLearnt') === 'true'
  );
  const [showRomajiCol, setShowRomajiCol] = useState(
    () => localStorage.getItem('showRomajiCol') !== 'false'
  );

  function toggleRomajiCol(on) {
    setShowRomajiCol(on);
    localStorage.setItem('showRomajiCol', on);
  }

  const [openSeen, setOpenSeen] = useState(null);
  const [flashKey, setFlashKey] = useState(null);
  const isMobile = useMediaQuery('(max-width: 720px)');
  const [tab, setTab] = useState('lyrics'); // 'lyrics' | 'vocab' | 'grammar'
  const [vocabFilter, setVocabFilter] = useState('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);
  const [zoom, setZoom] = useState(null); // vocab entry shown large in a modal
  const groupsRef = useRef(null);
  // Vocab group names collapsed on mobile (tap the header to toggle).
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  // Lyric line id to return to after a long-press jumped to the vocab tab.
  const [returnToLyrics, setReturnToLyrics] = useState(null);

  // Portal target in the global top app bar (mobile only) for the lyrics
  // toggles. Resolved after mount so the DOM node exists.
  const [topBarSlot, setTopBarSlot] = useState(null);
  useEffect(() => {
    setTopBarSlot(document.getElementById('mobile-bar-slot'));
  }, []);

  // Close the vocab filter dropdown on an outside click.
  useEffect(() => {
    if (!filterOpen) return;
    function onDocClick(e) {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [filterOpen]);

  // Desktop: make every group table as wide as the widest one (CSS can't
  // "match the widest sibling"), then pin the container to exactly the number
  // of columns that fit so it hugs the tables instead of filling the width.
  useLayoutEffect(() => {
    function layout() {
      const container = groupsRef.current;
      if (!container) return;
      const groups = [...container.querySelectorAll('.vocab-group')];
      groups.forEach((g) => (g.style.width = ''));
      container.style.width = '';
      if (isMobile || groups.length < 2) return;
      const max = Math.max(...groups.map((g) => g.offsetWidth));
      groups.forEach((g) => (g.style.width = `${max}px`));
      const gap = 20;
      const avail = (container.closest('.song-view') ?? container).clientWidth;
      const cols = Math.max(1, Math.min(groups.length, Math.floor((avail + gap) / (max + gap))));
      container.style.width = `${cols * max + (cols - 1) * gap}px`;
    }
    layout();
    window.addEventListener('resize', layout);
    return () => window.removeEventListener('resize', layout);
  });

  useEffect(() => {
    api.getLearnt().then((words) => setLearnt(new Set(words))).catch(() => {});
    api.getSaved().then((words) => setSaved(new Set(words))).catch(() => {});
  }, []);

  // After navigating from a "seen in" popup / study hint, switch to the right
  // tab, make the target visible, then scroll to it and flash it.
  useEffect(() => {
    if (!focus) return;
    let elementId = `${focus.kind}-${focus.key}`;
    if (focus.kind === 'vocab') {
      const lineIdx = findLineForWord(song.lines ?? [], focus.key);
      if (lineIdx >= 0) {
        setTab('lyrics');
        elementId = `line-${lineIdx}`;
      } else {
        setTab('vocab');
        setVocabFilter('All');
        if (learnt.has(focus.key)) setShowLearnt(true);
        elementId = `vocab-${focus.key}`;
      }
    } else if (focus.kind === 'vocab-row') {
      setTab('vocab');
      setVocabFilter('All');
      if (learnt.has(focus.key)) setShowLearnt(true);
      elementId = `vocab-${focus.key}`;
    } else if (focus.kind === 'grammar') {
      setTab('grammar');
    }
    const t = setTimeout(() => {
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashKey(elementId);
      clearFocus();
      setTimeout(() => setFlashKey(null), 2500);
    }, 120);
    return () => clearTimeout(t);
  }, [focus, song.id]);

  function SeenBadge({ seenIn, badgeId, kind, itemKey }) {
    if (!seenIn?.length) return null;
    const open = openSeen === badgeId;
    return (
      <span className="seen-badge-wrap">
        <button
          className="seen-badge"
          title={`Seen in ${seenIn.length} previous song${seenIn.length > 1 ? 's' : ''} — click for details`}
          onClick={(e) => {
            e.stopPropagation();
            setOpenSeen(open ? null : badgeId);
          }}
        >
          <span className="sb-arrow">↻</span> {seenIn.length}
        </button>
        {open && (
          <span className="seen-pop" onClick={(e) => e.stopPropagation()}>
            <span className="seen-pop-title">Seen before in</span>
            {seenIn.map((s, i) =>
              typeof s === 'string' ? (
                <span key={i} className="seen-pop-item plain">
                  {s}
                </span>
              ) : (
                <button
                  key={i}
                  className="seen-pop-item"
                  onClick={() => {
                    setOpenSeen(null);
                    onNavigate(s.id, { kind, key: itemKey });
                  }}
                >
                  {s.title}
                  {s.artist ? ` — ${s.artist}` : ''}
                </button>
              )
            )}
          </span>
        )}
      </span>
    );
  }

  function toggleShowLearnt(on) {
    setShowLearnt(on);
    localStorage.setItem('showLearnt', on);
  }

  function toggleLearnt(word) {
    const key = normWord(word);
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

  function toggleSaved(word) {
    const key = normWord(word);
    const next = new Set(saved);
    if (next.has(key)) {
      next.delete(key);
      api.removeSaved(key).then(onSavedChange).catch(() => {});
    } else {
      next.add(key);
      api.addSaved(key).then(onSavedChange).catch(() => {});
    }
    setSaved(next);
  }

  function toggleRomaji(on) {
    setShowRomaji(on);
    localStorage.setItem('showRomaji', on);
  }

  function toggleTranslation(on) {
    setShowTranslation(on);
    localStorage.setItem('showTranslation', on);
  }

  function toggleGroup(group) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  }

  // Maps a lyric word (surface form) to its vocabulary entry. Tries an exact
  // match first, then a shared leading stem (so conjugated forms like 言って
  // still find 言う). Returns null for words not in the vocab table (particles,
  // trivial words the AI skips).
  function findVocabForToken(tokenWord) {
    const t = normWord(tokenWord);
    if (!t) return null;
    const exact = song.vocabulary.find((v) => normWord(v.word) === t);
    if (exact) return exact;
    for (let len = t.length; len >= 1; len--) {
      const frag = t.slice(0, len);
      // Don't match on a single kana fragment — too loose; a lone kanji is fine.
      if (len === 1 && !/\p{Script=Han}/u.test(frag)) continue;
      const hit = song.vocabulary.find((v) => normWord(v.word).startsWith(frag));
      if (hit) return hit;
    }
    return null;
  }

  // Long-press on a lyric word jumps to its row in the vocabulary tab, and
  // remembers the originating line so a "back to lyrics" button can return there.
  function jumpToVocab(tokenWord, tokenId) {
    const entry = findVocabForToken(tokenWord);
    if (!entry) return;
    const key = normWord(entry.word);
    const lineIdx = String(tokenId ?? '').split('-')[0];
    setReturnToLyrics(lineIdx !== '' ? `line-${lineIdx}` : null);
    setTab('vocab');
    setVocabFilter('All');
    if (learnt.has(key)) setShowLearnt(true);
    // Make sure the target group isn't collapsed (mobile) so the row renders.
    const grp = vocabGroup(entry.partOfSpeech);
    setCollapsedGroups((prev) => {
      if (!prev.has(grp)) return prev;
      const next = new Set(prev);
      next.delete(grp);
      return next;
    });
    flashTo(`vocab-${key}`);
  }

  // Returns from the vocab tab to the line the long-press came from.
  function backToLyrics() {
    const target = returnToLyrics;
    setReturnToLyrics(null);
    setTab('lyrics');
    if (target) flashTo(target);
  }

  // Scrolls an element into view and flashes it.
  function flashTo(elementId) {
    setTimeout(() => {
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashKey(elementId);
      setTimeout(() => setFlashKey(null), 2500);
    }, 140);
  }
  const learntCount = song.vocabulary.filter((v) => learnt.has(normWord(v.word))).length;
  const visibleVocab = showLearnt
    ? song.vocabulary
    : song.vocabulary.filter((v) => !learnt.has(normWord(v.word)));

  // Groups (with counts) present in the currently visible vocabulary.
  const presentGroups = VOCAB_GROUP_ORDER.map((g) => ({
    group: g,
    entries: visibleVocab.filter((v) => vocabGroup(v.partOfSpeech) === g),
  })).filter((x) => x.entries.length > 0);

  function renderVocabTable(entries) {
    return (
      <table>
        <tbody>
          {entries.map((v, i) => {
            const isLearnt = learnt.has(normWord(v.word));
            const isSaved = saved.has(normWord(v.word));
            const rowId = `vocab-${normWord(v.word)}`;
            const rowClass = `${isLearnt ? 'learnt' : ''} ${flashKey === rowId ? 'flash' : ''}`;
            const badge = (
              <SeenBadge seenIn={v.seenIn} badgeId={rowId} kind="vocab" itemKey={normWord(v.word)} />
            );
            const saveBtn = (
              <button
                className={`save-btn ${isSaved ? 'on' : ''}`}
                title={isSaved ? 'Remove from Words' : 'Save to Words'}
                onClick={() => toggleSaved(v.word)}
              >
                {isSaved ? '★' : '☆'}
              </button>
            );
            const learnBtn = (
              <button
                className={`learn-btn ${isLearnt ? 'on' : ''}`}
                title={isLearnt ? 'Mark as not learnt' : 'Mark as learnt'}
                onClick={() => toggleLearnt(v.word)}
              >
                ✓
              </button>
            );
            return isMobile ? (
              <tr key={i} id={rowId} className={rowClass}>
                <td className="word-cell" title={v.partOfSpeech}>
                  <span className="jp w-main word-zoom" onClick={() => setZoom(v)}>
                    {v.word}
                  </span>
                  {v.reading !== v.word && <span className="jp w-reading">{v.reading}</span>}
                  {showRomajiCol && <span className="w-romaji">{v.romaji}</span>}
                </td>
                <td>{v.meaning}</td>
                <td className="row-actions-m">
                  <div className="actions-wrap">
                    {badge}
                    {saveBtn}
                    {learnBtn}
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={i} id={rowId} className={rowClass}>
                <td className="jp word-zoom" title={v.partOfSpeech} onClick={() => setZoom(v)}>
                  {v.word}
                </td>
                <td className="jp">{v.reading}</td>
                {showRomajiCol && <td>{v.romaji}</td>}
                <td className="meaning-cell">{v.meaning}</td>
                <td className="row-actions">
                  <div className="actions-wrap">
                    {badge}
                    {saveBtn}
                    {learnBtn}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  const lyricsToggles = (
    <>
      <label className="romaji-toggle">
        <input
          type="checkbox"
          checked={script === 'kana'}
          onChange={(e) => setScript(e.target.checked ? 'kana' : 'kanji')}
        />
        <span className="switch" aria-hidden="true" />
        kana
      </label>
      <label className="romaji-toggle">
        <input
          type="checkbox"
          checked={showRomaji}
          onChange={(e) => toggleRomaji(e.target.checked)}
        />
        <span className="switch" aria-hidden="true" />
        rōmaji
      </label>
      <label className="romaji-toggle" title="translation">
        <input
          type="checkbox"
          checked={showTranslation}
          onChange={(e) => toggleTranslation(e.target.checked)}
        />
        <span className="switch" aria-hidden="true" />
        <span className="tl-icon">文A</span>
      </label>
    </>
  );

  const vocabToggles = (
    <>
      <label className="romaji-toggle">
        <input
          type="checkbox"
          checked={showRomajiCol}
          onChange={(e) => toggleRomajiCol(e.target.checked)}
        />
        <span className="switch" aria-hidden="true" />
        rōmaji
      </label>
      <label className="romaji-toggle">
        <input
          type="checkbox"
          checked={showLearnt}
          onChange={(e) => toggleShowLearnt(e.target.checked)}
        />
        <span className="switch" aria-hidden="true" />
        learnt
      </label>
    </>
  );

  return (
    <div
      className="song-view"
      onClick={() => {
        if (openTokenId) setOpenTokenId(null);
        if (openSeen) setOpenSeen(null);
      }}
    >
      {/* On mobile the lyrics/vocab toggles live in the global top app bar; on
          desktop they stay in the song header. */}
      {tab === 'lyrics' &&
        isMobile &&
        topBarSlot &&
        createPortal(<div className="topbar-toggles">{lyricsToggles}</div>, topBarSlot)}
      {tab === 'vocab' &&
        isMobile &&
        topBarSlot &&
        createPortal(<div className="topbar-toggles">{vocabToggles}</div>, topBarSlot)}

      <header className="song-header">
        <div className="song-header-main">
          <h2>{song.title}</h2>
          {song.artist && <p className="artist">{song.artist}</p>}
        </div>
        {tab === 'lyrics' && !isMobile && <div className="header-toggles">{lyricsToggles}</div>}
        {tab === 'vocab' && (
          <div className="header-toggles">
            {!isMobile && vocabToggles}
            <div className="vocab-filter" ref={filterRef}>
              <button
                className={`filter-btn ${vocabFilter !== 'All' ? 'active' : ''}`}
                onClick={() => setFilterOpen((o) => !o)}
                title="Filter by word type"
                aria-label="Filter by word type"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 4h18v2l-7 7v6l-4-2v-4L3 6z"
                  />
                </svg>
                <span className="filter-label">{vocabFilter}</span>
              </button>
              {filterOpen && (
                <div className="filter-menu">
                  <button
                    className={`filter-option ${vocabFilter === 'All' ? 'active' : ''}`}
                    onClick={() => {
                      setVocabFilter('All');
                      setFilterOpen(false);
                    }}
                  >
                    All <span className="filter-count">{visibleVocab.length}</span>
                  </button>
                  {presentGroups.map(({ group, entries }) => (
                    <button
                      key={group}
                      className={`filter-option ${vocabFilter === group ? 'active' : ''}`}
                      onClick={() => {
                        setVocabFilter(group);
                        setFilterOpen(false);
                      }}
                    >
                      {group} <span className="filter-count">{entries.length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="song-nav">
        <div className="song-tabs">
          <button
            className={tab === 'lyrics' ? 'active' : ''}
            onClick={() => {
              setTab('lyrics');
              setReturnToLyrics(null);
            }}
          >
            Lyrics
          </button>
          <button className={tab === 'vocab' ? 'active' : ''} onClick={() => setTab('vocab')}>
            Vocab <span className="tab-count">{song.vocabulary.length}</span>
          </button>
          <button
            className={tab === 'grammar' ? 'active' : ''}
            onClick={() => {
              setTab('grammar');
              setReturnToLyrics(null);
            }}
          >
            Grammar <span className="tab-count">{song.grammar.length}</span>
          </button>
        </div>
      </div>

      {tab === 'lyrics' && (
        <section className="card tab-panel" key="lyrics">
          <div className="lyrics">
            {song.lines.map((line, i) => {
              if (!line[script]?.trim()) return <p key={i} className="gap" />;
              const isChorus = line.section === 'chorus';
              const startsChorus =
                isChorus &&
                song.lines.slice(0, i).findLast((l) => l[script]?.trim())?.section !== 'chorus';
              return (
                <div
                  key={i}
                  id={`line-${i}`}
                  className={`line ${isChorus ? 'chorus' : ''} ${flashKey === `line-${i}` ? 'flash' : ''}`}
                >
                  {startsChorus && <span className="section-label">サビ Chorus</span>}
                  <p>
                    <LineText
                      line={line}
                      script={script}
                      lineIdx={i}
                      openId={openTokenId}
                      setOpenId={setOpenTokenId}
                      onHold={jumpToVocab}
                    />
                  </p>
                  {showRomaji && line.romaji?.trim() && (
                    <p className="romaji-sub">{line.romaji}</p>
                  )}
                  {showTranslation && line.translation?.trim() && (
                    <p className="translation-sub">{line.translation}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'vocab' && (
        <section className="card vocab-card tab-panel" key={`vocab-${vocabFilter}`}>
          {visibleVocab.length === 0 ? (
            <p className="muted">
              All {song.vocabulary.length} words of this song are marked as learnt. Nice work! Flip
              the “learnt” toggle to see them.
            </p>
          ) : (
            <div className="vocab-groups" ref={groupsRef}>
              {(vocabFilter === 'All'
                ? presentGroups
                : presentGroups.filter((g) => g.group === vocabFilter)
              ).map(({ group, entries }) => {
                const collapsed = isMobile && collapsedGroups.has(group);
                return (
                  <div key={group} className="vocab-group">
                    {vocabFilter === 'All' && (
                      <h4
                        className={collapsed ? 'collapsed' : ''}
                        role={isMobile ? 'button' : undefined}
                        aria-expanded={isMobile ? !collapsed : undefined}
                        onClick={isMobile ? () => toggleGroup(group) : undefined}
                      >
                        {isMobile ? (
                          <>
                            <span>
                              {group} <span className="count">{entries.length}</span>
                            </span>
                            <span className="group-chev" aria-hidden="true">▾</span>
                          </>
                        ) : (
                          <>
                            {group} <span className="count">{entries.length}</span>
                          </>
                        )}
                      </h4>
                    )}
                    {!collapsed && renderVocabTable(entries)}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'grammar' && (
        <section className="card grammar-card tab-panel" key="grammar">
          <div className="grammar-list">
            {song.grammar.map((g, i) => {
              const itemId = `grammar-${normWord(g.pattern)}`;
              return (
                <div
                  key={i}
                  id={itemId}
                  className={`grammar-item ${flashKey === itemId ? 'flash' : ''}`}
                >
                  <div className="grammar-title">
                    <span className="jp pattern">{g.pattern}</span>
                    <span className="label">{g.label}</span>
                    <SeenBadge
                      seenIn={g.seenIn}
                      badgeId={itemId}
                      kind="grammar"
                      itemKey={normWord(g.pattern)}
                    />
                  </div>
                  <p>{g.explanation}</p>
                  {g.example && <p className="example jp">「{g.example}」</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {returnToLyrics && tab === 'vocab' && (
        <button className="back-btn" onClick={backToLyrics}>
          ← Back to lyrics
        </button>
      )}

      {zoom && (
        <div className="zoom-overlay" onClick={() => setZoom(null)}>
          <div className="zoom-card" onClick={(e) => e.stopPropagation()}>
            <button className="zoom-close" title="Close" onClick={() => setZoom(null)}>
              ×
            </button>
            <span className="jp zoom-word">{zoom.word}</span>
            {zoom.reading !== zoom.word && <span className="jp zoom-reading">{zoom.reading}</span>}
            {zoom.romaji && <span className="zoom-romaji">{zoom.romaji}</span>}
            <span className="zoom-divider" />
            <span className="zoom-meaning">{zoom.meaning}</span>
            {zoom.partOfSpeech && <span className="zoom-pos">{zoom.partOfSpeech}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
