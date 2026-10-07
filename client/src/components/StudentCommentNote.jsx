import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const CHECK_LABEL = {
  open: 'Mark this comment as checked',
  reopen: 'Mark this comment as checked again',
  fixed: 'Waiting for your teacher',
  resolved: 'Teacher confirmed this',
};

function NoteIcon({ tone }) {
  if (tone === 'open' || tone === 'reopen') {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M3.2 4.2h9.6M3.2 8h6.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.4 8.2 3.1 3.1 6.1-6.6" />
    </svg>
  );
}

function visibleBoxFor(node) {
  const box = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let el = node; el && el !== document.body; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const rect = el.getBoundingClientRect();
    box.top = Math.max(box.top, rect.top);
    box.left = Math.max(box.left, rect.left);
    box.right = Math.min(box.right, rect.right);
    box.bottom = Math.min(box.bottom, rect.bottom);
  }
  return box;
}

export default function StudentCommentNote({
  tone = 'open',
  note = '',
  lit = false,
  detached = false,
  stacked = false,
  busy = false,
  onCheck,
  className = '',
  ...props
}) {
  const label = String(note || '').trim() || 'Teacher comment';
  const canCheck = (tone === 'open' || tone === 'reopen') && typeof onCheck === 'function';
  const hoverTimerRef = useRef(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const fullRef = useRef(null);
  const [placement, setPlacement] = useState('');

  useLayoutEffect(() => {
    const full = fullRef.current;
    if (!open || !full) {
      setPlacement('');
      return;
    }
    const anchor = full.parentElement.getBoundingClientRect();
    const rect = full.getBoundingClientRect();
    const box = visibleBoxFor(full.parentElement.parentElement);
    const below = rect.top < box.top + 4 && box.bottom - anchor.bottom > anchor.top - box.top;
    const shiftRight = rect.left < box.left + 4;
    setPlacement(`${below ? ' is-below' : ''}${shiftRight ? ' is-shifted' : ''}`);
  }, [open]);

  useEffect(() => {
    if (!pinned) return undefined;
    function onDown(event) {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.('.iboard-student-note')) return;
      setPinned(false);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned]);

  function keepOpen() {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(true);
  }

  function scheduleClose() {
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHovered(false);
    }, 140);
  }

  useEffect(() => () => {
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  return (
    <div
      data-teacher-annotation-ui
      className={`iboard-student-note iboard-student-note--${tone}${detached ? ' is-detached' : ''}${stacked ? ' is-stacked' : ''}${lit ? ' is-lit' : ''}${open ? ' is-open' : ''} ${className}`.trim()}
      onMouseEnter={keepOpen}
      onMouseLeave={scheduleClose}
      {...props}
    >
      <button
        type="button"
        className="iboard-student-note__check"
        aria-expanded={open}
        aria-label={canCheck ? CHECK_LABEL[tone] || CHECK_LABEL.open : label}
        onClick={() => setPinned((current) => !current)}
      >
        <NoteIcon tone={tone} />
      </button>
      {open ? (
        <div
          ref={fullRef}
          className={`iboard-student-note__full${placement}`}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
        >
          <p className="iboard-student-note__body">{label}</p>
          {canCheck ? (
            <button
              type="button"
              className="iboard-student-note__fix"
              disabled={busy}
              onClick={onCheck}
            >
              Mark as checked
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
