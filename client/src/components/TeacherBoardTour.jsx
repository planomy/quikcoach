import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeViewportChanges } from '../lib/viewport.js';

const STORAGE_KEY = 'iboard-teacher-tour';
/** Pill fades in near the end of the ring slide. */
const PILL_IN_DELAY_MS = 480;

const STEPS = [
  { id: 'share', text: 'Share items with your students', place: 'right', clip: 'rail' },
  { id: 'engage', text: 'Ask the class and watch answers', place: 'right', clip: 'rail' },
  { id: 'board', text: 'Toggle student writing card view, set a timer, manage the session', place: 'right', clip: 'rail' },
  { id: 'rec', text: "Record your students' drafting", place: 'left', clip: 'header' },
  { id: 'headerTools', text: 'Go fullscreen, take a snapshot of all writing, view the help menu', place: 'left', clip: 'header' },
];

function readDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    return true;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    /* storage may be unavailable */
  }
}

function findClip(anchor, kind) {
  if (!anchor) return null;
  if (kind === 'header') {
    return anchor.closest('.iboard-app-header') || anchor.closest('.iboard-teacher-header-bar') || anchor.parentElement;
  }
  return anchor.closest('.iboard-arr-rail') || anchor.parentElement;
}

/** Prefer the button cluster inside a flex section (e.g. Ask/Responses), not empty stretch space. */
function contentRect(anchor) {
  if (!anchor) return null;
  const nodes = anchor.querySelectorAll('button, .iboard-arr-btn, .iboard-rec-switch');
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let hit = 0;
  nodes.forEach((node) => {
    const r = node.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    hit += 1;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  });
  if (!hit) {
    const r = anchor.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }
  const pad = 5;
  left -= pad;
  top -= pad;
  right += pad;
  bottom += pad;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Empty rounded stroke around the target, inset so it stays inside rail/header. */
function measureRing(anchor, clipKind) {
  if (!anchor) return null;
  const target = contentRect(anchor);
  if (!target) return null;
  const clip = findClip(anchor, clipKind)?.getBoundingClientRect();
  const edge = 4;

  let left = target.left;
  let top = target.top;
  let right = target.right;
  let bottom = target.bottom;

  if (clipKind === 'header' && clip) {
    const hx = 16;
    top = clip.top + edge;
    bottom = clip.bottom - edge;
    left = Math.max(clip.left + edge, target.left - hx);
    right = Math.min(clip.right - edge, target.right + hx);
  } else if (clip) {
    left = Math.max(left, clip.left + edge);
    top = Math.max(top, clip.top + edge);
    right = Math.min(right, clip.right - edge);
    bottom = Math.min(bottom, clip.bottom - edge);
  }

  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width < 8 || height < 8) return null;
  return { left, top, width, height, radius: clipKind === 'header' ? 10 : 12 };
}

function placeBesideAnchor(anchor, pill, place, ringBox = null) {
  const fallback = contentRect(anchor) || anchor.getBoundingClientRect();
  const target = ringBox
    ? {
        left: ringBox.left,
        right: ringBox.left + ringBox.width,
        top: ringBox.top,
        height: ringBox.height,
      }
    : fallback;
  const measured = pill?.getBoundingClientRect?.();
  const size = {
    width: measured?.width > 8 ? measured.width : 320,
    height: measured?.height > 8 ? measured.height : 48,
  };
  const gap = place === 'left' ? 20 : 14;
  let left = place === 'right'
    ? target.right + gap
    : target.left - size.width - gap;
  let top = target.top + target.height / 2 - size.height / 2;
  const pad = 8;
  left = Math.max(pad, Math.min(left, window.innerWidth - size.width - pad));
  top = Math.max(pad, Math.min(top, window.innerHeight - size.height - pad));
  return { left, top, aim: place === 'right' ? 'left' : 'right' };
}

/**
 * First-visit coach marks: one focus ring slides between stops;
 * the caption pill fades in as the ring lands.
 */
export default function TeacherBoardTour({ anchors }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [step, setStep] = useState(0);
  const [ring, setRing] = useState(null);
  const [box, setBox] = useState(null);
  const [ringMotion, setRingMotion] = useState(false);
  const [pillShown, setPillShown] = useState(false);
  const pillRef = useRef(null);
  const stepRef = useRef(0);
  const firstRingRef = useRef(true);
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;

  const show = !dismissed;
  const current = STEPS[step];
  stepRef.current = step;

  function dismiss() {
    rememberDismissed();
    setDismissed(true);
  }

  function next() {
    if (stepRef.current >= STEPS.length - 1) dismiss();
    else setStep((value) => value + 1);
  }

  useEffect(() => {
    if (!show) return undefined;
    document.documentElement.setAttribute('data-iboard-tour', '1');
    return () => document.documentElement.removeAttribute('data-iboard-tour');
  }, [show]);

  useEffect(() => {
    if (!show) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  useLayoutEffect(() => {
    if (!show) {
      setRing(null);
      setBox(null);
      setPillShown(false);
      return undefined;
    }
    // Snap-hide on step change only (this effect deps on step, not box updates).
    setPillShown(false);
    const place = () => {
      const live = anchorsRef.current;
      const anchor = live?.[current.id]?.current;
      if (!anchor) return false;
      const nextRing = measureRing(anchor, current.clip);
      if (!nextRing) return false;
      setRing(nextRing);
      setBox(placeBesideAnchor(anchor, pillRef.current, current.place, nextRing));
      return true;
    };
    place();
    const retryA = window.setTimeout(place, 50);
    const retryB = window.setTimeout(place, 200);
    return () => {
      window.clearTimeout(retryA);
      window.clearTimeout(retryB);
    };
  }, [show, step, current.id, current.place, current.clip]);

  useEffect(() => {
    if (!show) return undefined;
    const unsub = subscribeViewportChanges(() => {
      const live = anchorsRef.current;
      const anchor = live?.[current.id]?.current;
      if (!anchor) return;
      const nextRing = measureRing(anchor, current.clip);
      if (!nextRing) return;
      setRing(nextRing);
      setBox(placeBesideAnchor(anchor, pillRef.current, current.place, nextRing));
    });
    return unsub;
  }, [show, step, current.id, current.place, current.clip]);

  useEffect(() => {
    if (!show || !ring) return undefined;
    if (firstRingRef.current) {
      firstRingRef.current = false;
      const frame = requestAnimationFrame(() => setRingMotion(true));
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [show, ring]);

  // Fade in on step change only — must NOT depend on `box`, or place() retries
  // clear the timer and the pill stays opacity 0 forever.
  useEffect(() => {
    if (!show) return undefined;
    setPillShown(false);
    const delay = step === 0 ? 200 : PILL_IN_DELAY_MS;
    const timer = window.setTimeout(() => setPillShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [show, step]);

  if (!show || typeof document === 'undefined') return null;

  const last = step === STEPS.length - 1;

  return createPortal(
    <>
      {ring ? (
        <div
          className={`iboard-tour-ring${ringMotion ? ' is-moving' : ''}`}
          style={{
            top: ring.top,
            left: ring.left,
            width: ring.width,
            height: ring.height,
            borderRadius: ring.radius,
          }}
          aria-hidden="true"
        />
      ) : null}
      <div
        ref={pillRef}
        className={`iboard-tour${pillShown ? ' is-shown' : ''}`}
        style={{
          top: box ? box.top : -9999,
          left: box ? box.left : -9999,
          // Keep in accessibility tree; opacity handles hide/show.
          visibility: 'visible',
          pointerEvents: pillShown && box ? 'auto' : 'none',
        }}
        role="dialog"
        aria-label="Teacher board tour"
        aria-hidden={!pillShown}
      >
        {box?.aim ? (
          <span className={`iboard-tour__arrow iboard-tour__arrow--${box.aim}`} aria-hidden="true" />
        ) : null}
        <p className="iboard-tour__text">{current.text}</p>
        <span className="iboard-tour__count">{step + 1}/{STEPS.length}</span>
        <button type="button" className="iboard-tour__next" onClick={next}>
          {last ? 'Done' : 'Next'}
        </button>
        <button type="button" className="iboard-tour__close" onClick={dismiss} aria-label="Close tour">
          ×
        </button>
      </div>
    </>,
    document.body
  );
}
