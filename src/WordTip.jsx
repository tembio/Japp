import React, { useRef, useState } from 'react';

// On hover-capable devices (desktop) the tooltip is pure CSS hover; tap-to-open
// is only for touch screens. Evaluated live so devtools mobile emulation and
// convertible devices are detected correctly.
const isTouch = () => window.matchMedia('(hover: none)').matches;

// Wraps `children` (the trigger) in the same word card used in the lyrics view:
// word, reading, rōmaji and meaning. Hovering shows it on desktop; tapping
// toggles it on touch. The tip is centered then nudged so it never overflows
// the viewport.
//
// Pass `id` + `openId` + `setOpenId` to share a single "which one is open"
// state across a list, so opening one tip closes any other. Without them the
// component keeps its own local open state.
export default function WordTip({
  word,
  reading,
  romaji,
  meaning,
  partOfSpeech,
  children,
  className = '',
  id,
  openId,
  setOpenId,
}) {
  const ref = useRef(null);
  const [shift, setShift] = useState(0);
  const [below, setBelow] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);

  const controlled = setOpenId != null;
  const open = controlled ? openId === id : localOpen;
  const toggle = () =>
    controlled ? setOpenId(openId === id ? null : id) : setLocalOpen((o) => !o);

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
      // Flip below the word when there isn't room above it (e.g. the first line).
      const wordRect = ref.current.getBoundingClientRect();
      setBelow(wordRect.top - rect.height - 10 < margin);
    });
  }

  return (
    <span
      ref={ref}
      className={`token ${open ? 'open' : ''} ${className}`}
      onMouseEnter={clampTip}
      onClick={(e) => {
        if (!isTouch()) return;
        e.stopPropagation();
        toggle();
        clampTip();
      }}
    >
      {children}
      <span
        className={`tip ${below ? 'below' : ''}`}
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
      >
        <span className="tip-inner">
          <span className="tip-word jp">{word}</span>
          {reading && reading !== word && <span className="tip-reading jp">{reading}</span>}
          {romaji && <span className="tip-romaji">{romaji}</span>}
          <span className="tip-divider" />
          {meaning && <span className="tip-meaning">{meaning}</span>}
          {partOfSpeech && <span className="tip-pos">{partOfSpeech}</span>}
        </span>
      </span>
    </span>
  );
}
