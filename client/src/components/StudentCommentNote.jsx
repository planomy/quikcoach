import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import HintWrap from './HintWrap.jsx';
import { COMMENT_PIP_HINT } from '../lib/annotations.js';

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

export default function StudentCommentNote({
  tone = 'open',
  note = '',
  lit = false,
  detached = false,
  busy = false,
  onCheck,
  className = '',
  ...props
}) {
  const label = String(note || '').trim() || 'Teacher comment';
  const canCheck = (tone === 'open' || tone === 'reopen') && typeof onCheck === 'function';
  const textRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const [clipped, setClipped] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = clipped && (pinned || hovered);

  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) {
      setClipped(false);
      return undefined;
    }
    const measure = () => {
      setClipped(node.scrollWidth > node.clientWidth + 1);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [label]);

  useEffect(() => {
    if (!clipped) {
      setPinned(false);
      setHovered(false);
    }
  }, [clipped]);

  useEffect(() => {
    if (!pinned) return undefined;
    function onDown(event) {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.('.iboard-student-note__full, .iboard-student-note__text')) return;
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
    if (clipped) setHovered(true);
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
      className={`iboard-student-note iboard-student-note--${tone}${detached ? ' is-detached' : ''}${lit ? ' is-lit' : ''}${open ? ' is-open' : ''} ${className}`.trim()}
      {...props}
    >
      <span className="iboard-student-note__stem" aria-hidden="true" />
      <button
        type="button"
        ref={textRef}
        className="iboard-student-note__text"
        aria-expanded={clipped ? open : undefined}
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        onClick={() => {
          if (!clipped) return;
          setPinned((current) => !current);
        }}
      >
        {label}
      </button>
      {open ? (
        <div
          className="iboard-student-note__full"
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
        >
          {label}
        </div>
      ) : null}
      <HintWrap hint={COMMENT_PIP_HINT[tone] || COMMENT_PIP_HINT.open} prefer="above" className="pointer-events-auto">
        <button
          type="button"
          className="iboard-student-note__check"
          disabled={!canCheck || busy}
          onClick={canCheck ? onCheck : undefined}
          aria-label={CHECK_LABEL[tone] || CHECK_LABEL.open}
        >
          <NoteIcon tone={tone} />
        </button>
      </HintWrap>
    </div>
  );
}
