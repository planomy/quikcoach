import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampFixedBox } from '../lib/clampPopup.js';
import { subscribeViewportChanges } from '../lib/viewport.js';
import { useHintsOff } from '../lib/hintPrefs.js';

const HINT_PAD = 8;
const HINT_GAP = 6;
const EST_HEIGHT = 22;
const CURSOR_OFFSET_X = 10;
const CURSOR_OFFSET_Y = 18;
const FIRST_HOVER_DELAY = 350;
const FOLLOW_ON_HOVER_DELAY = 75;
const FOLLOW_ON_GRACE_PERIOD = 700;

// Keep hover intent shared across HintWrap instances so moving along a toolbar
// feels quick after the user has deliberately opened one tooltip.
let fastHoverUntil = 0;

// Hover hints sit just below and to the right of the pointer, like a native tooltip.
// Keyboard focus has no pointer, so the hint goes under the item instead.
// Either way the box is kept inside the viewport.
function measureAndPlace(wrapEl, tipEl, hint, pointer) {
  const rect = wrapEl?.getBoundingClientRect();
  if (!rect) return null;
  const width = tipEl?.offsetWidth || Math.max(48, String(hint).length * 7 + 16);
  const height = tipEl?.offsetHeight || EST_HEIGHT;
  const hasPointer = Number.isFinite(pointer?.x) && Number.isFinite(pointer?.y);
  const left = hasPointer ? pointer.x + CURSOR_OFFSET_X : rect.left + rect.width / 2 - width / 2;
  const top = hasPointer ? pointer.y + CURSOR_OFFSET_Y : rect.bottom + HINT_GAP;
  return clampFixedBox({ top, left, width, height, padding: HINT_PAD });
}

/** Fast hover/focus hint chip in Apple iron grey, placed below and right of the pointer. */
export default function HintWrap({ hint, children, className = '', prefer: _prefer, multiline = false, tone = 'brand', suppressed: suppressedProp = false, keep = false }) {
  const hintsOff = useHintsOff();
  const suppressed = suppressedProp || (!keep && hintsOff);
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const openedByHoverRef = useRef(false);
  // Pointer activation focuses the control after pointerdown; skip that focus so the
  // tip does not flash open for a frame before clickCapture hides it again.
  const ignoreFocusUntilRef = useRef(0);
  const pointerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const hideNow = () => {
    clearHoverTimer();
    if (openedByHoverRef.current) fastHoverUntil = Date.now() + FOLLOW_ON_GRACE_PERIOD;
    openedByHoverRef.current = false;
    setOpen(false);
  };

  const openFromHover = (event) => {
    if (suppressed) return;
    pointerRef.current = Number.isFinite(event?.clientX) ? { x: event.clientX, y: event.clientY } : null;
    clearHoverTimer();
    const delay = Date.now() < fastHoverUntil ? FOLLOW_ON_HOVER_DELAY : FIRST_HOVER_DELAY;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      openedByHoverRef.current = true;
      setOpen(true);
    }, delay);
  };

  const trackPointer = (event) => {
    if (open || !Number.isFinite(event?.clientX)) return;
    pointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const closeFromHover = () => {
    hideNow();
  };

  const openFromFocus = () => {
    if (suppressed) return;
    if (typeof performance !== 'undefined' && performance.now() < ignoreFocusUntilRef.current) return;
    clearHoverTimer();
    pointerRef.current = null;
    openedByHoverRef.current = false;
    setOpen(true);
  };

  const onPointerDownCapture = () => {
    ignoreFocusUntilRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 500;
    hideNow();
  };

  useEffect(() => () => clearHoverTimer(), []);

  useEffect(() => {
    if (suppressed) hideNow();
  }, [suppressed]);

  useEffect(() => {
    if (!open || !hint) {
      setBox(null);
      return undefined;
    }

    const place = () => {
      setBox(measureAndPlace(wrapRef.current, tipRef.current, hint, pointerRef.current));
    };

    place();
    const frame = requestAnimationFrame(place);
    const unsubscribe = subscribeViewportChanges(place);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [open, hint]);

  if (!hint) return children;

  const hasPositionClass = /\b(static|fixed|absolute|relative|sticky)\b/.test(className);

  return (
    <span
      ref={wrapRef}
      className={`${hasPositionClass ? '' : 'relative '}inline-flex ${className}`.trim()}
      onMouseEnter={openFromHover}
      onMouseMove={trackPointer}
      onMouseLeave={closeFromHover}
      onPointerDownCapture={onPointerDownCapture}
      onClickCapture={hideNow}
      onFocusCapture={openFromFocus}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) hideNow();
      }}
    >
      {children}
      {open && typeof document !== 'undefined' && createPortal(
        <span
          ref={tipRef}
          role="tooltip"
          className={
            tone === 'card'
              ? 'pointer-events-none fixed z-[200] max-w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-[#2f5fee] bg-white text-left text-[10px] font-black leading-relaxed shadow-lg dark:border-[#818cf8] dark:bg-slate-900'
              : `pointer-events-none fixed z-[200] rounded-lg px-2 py-1 text-[10px] font-black text-white shadow-lg ring-1 ring-white/20 ${
                  multiline ? 'max-w-[min(22rem,calc(100vw-1rem))] whitespace-normal text-left leading-relaxed' : 'whitespace-nowrap leading-none'
                } bg-[#5e5e5e] dark:ring-white/25`
          }
          style={{
            top: box ? box.top : -9999,
            left: box ? box.left : -9999,
            visibility: box ? 'visible' : 'hidden',
          }}
        >
          {hint}
        </span>,
        document.body
      )}
    </span>
  );
}
