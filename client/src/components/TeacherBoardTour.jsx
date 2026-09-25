import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeViewportChanges } from '../lib/viewport.js';

const STORAGE_KEY = 'iboard-teacher-tour';

const STEPS = [
  { id: 'share', text: 'Share items with your students', place: 'right' },
  { id: 'engage', text: 'Ask the class and watch answers', place: 'right' },
  { id: 'board', text: 'View cards, set a timer, and manage the session', place: 'right' },
  { id: 'rec', text: "Record your students' drafting", place: 'left' },
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

/** First-visit coach marks for the teacher board. One pill; advance only via Next/Done. */
export default function TeacherBoardTour({ anchors }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState(null);
  const [motion, setMotion] = useState(false);
  const pillRef = useRef(null);
  const stepRef = useRef(0);

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
      setBox(null);
      return undefined;
    }
    const place = () => {
      const anchor = anchors?.[current.id]?.current;
      const pill = pillRef.current;
      if (!anchor || !pill) return;
      const target = anchor.getBoundingClientRect();
      const size = pill.getBoundingClientRect();
      const gap = 14;
      let left = current.place === 'right'
        ? target.right + gap
        : target.left - size.width - gap;
      let top = target.top + target.height / 2 - size.height / 2;
      const pad = 8;
      left = Math.max(pad, Math.min(left, window.innerWidth - size.width - pad));
      top = Math.max(pad, Math.min(top, window.innerHeight - size.height - pad));
      setBox({ left, top, aim: current.place === 'right' ? 'left' : 'right' });
    };
    place();
    return subscribeViewportChanges(place);
  }, [show, current.id, current.place, anchors]);

  useEffect(() => {
    if (!box || motion) return undefined;
    const frame = requestAnimationFrame(() => setMotion(true));
    return () => cancelAnimationFrame(frame);
  }, [box, motion]);

  if (!show || typeof document === 'undefined') return null;

  const last = step === STEPS.length - 1;

  return createPortal(
    <div
      ref={pillRef}
      className={`iboard-tour${motion ? ' is-moving' : ''}`}
      style={{
        top: box ? box.top : -9999,
        left: box ? box.left : -9999,
        visibility: box ? 'visible' : 'hidden',
      }}
      role="dialog"
      aria-label="Teacher board tour"
    >
      <span className={`iboard-tour__arrow iboard-tour__arrow--${box?.aim || 'left'}`} aria-hidden="true" />
      <p className="iboard-tour__text">{current.text}</p>
      <span className="iboard-tour__count">{step + 1}/{STEPS.length}</span>
      <button type="button" className="iboard-tour__next" onClick={next}>
        {last ? 'Done' : 'Next'}
      </button>
      <button type="button" className="iboard-tour__close" onClick={dismiss} aria-label="Close tour">
        ×
      </button>
    </div>,
    document.body
  );
}
