import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampFixedBox } from '../lib/clampPopup.js';
import { subscribeViewportChanges } from '../lib/viewport.js';
import { useHintsOff } from '../lib/hintPrefs.js';

const HINT_PAD = 8;
const HINT_GAP = 6;
const EST_HEIGHT = 22;
const FIRST_HOVER_DELAY = 350;
const FOLLOW_ON_HOVER_DELAY = 75;
const FOLLOW_ON_GRACE_PERIOD = 700;

// Keep hover intent shared across HintWrap instances so moving along a toolbar
// feels quick after the user has deliberately opened one tooltip.
let fastHoverUntil = 0;

// One rule for every hint in the app: just above the hovered item, centred on where
// the pointer entered it (item centre for keyboard focus), kept inside the viewport.
// It only drops below the item when there is no room above.
function measureAndPlace(wrapEl, tipEl, hint, pointerX) {
  const rect = wrapEl?.getBoundingClientRect();
  if (!rect) return null;
  const width = tipEl?.offsetWidth || Math.max(48, String(hint).length * 7 + 16);
  const height = tipEl?.offsetHeight || EST_HEIGHT;
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const centreX = Number.isFinite(pointerX) ? pointerX : rect.left + rect.width / 2;
  const aboveTop = rect.top - HINT_GAP - height;
  const top = aboveTop >= viewportTop + HINT_PAD ? aboveTop : rect.bottom + HINT_GAP;
  return clampFixedBox({ top, left: centreX - width / 2, width, height, padding: HINT_PAD });
}

/** Fast hover/focus hint chip — brand accent, flips below when there isn’t room above. */
export default function HintWrap({ hint, children, className = '', prefer: _prefer, multiline = false, tone = 'brand', suppressed: suppressedProp = false }) {
  const hintsOff = useHintsOff();
  const suppressed = suppressedProp || hintsOff;
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const openedByHoverRef = useRef(false);
  // Pointer activation focuses the control after pointerdown; skip that focus so the
  // tip does not flash open for a frame before clickCapture hides it again.
  const ignoreFocusUntilRef = useRef(0);
  const pointerXRef = useRef(null);
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
    pointerXRef.current = Number.isFinite(event?.clientX) ? event.clientX : null;
    clearHoverTimer();
    const delay = Date.now() < fastHoverUntil ? FOLLOW_ON_HOVER_DELAY : FIRST_HOVER_DELAY;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      openedByHoverRef.current = true;
      setOpen(true);
    }, delay);
  };

  const closeFromHover = () => {
    hideNow();
  };

  const openFromFocus = () => {
    if (suppressed) return;
    if (typeof performance !== 'undefined' && performance.now() < ignoreFocusUntilRef.current) return;
    clearHoverTimer();
    pointerXRef.current = null;
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
      setBox(measureAndPlace(wrapRef.current, tipRef.current, hint, pointerXRef.current));
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
              ? 'pointer-events-none fixed z-[200] max-w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-[#5a5fc3] bg-white text-left text-[10px] font-black leading-relaxed shadow-lg dark:border-[#818cf8] dark:bg-slate-900'
              : `pointer-events-none fixed z-[200] rounded-lg px-2 py-1 text-[10px] font-black text-white shadow-lg ring-1 ring-white/20 ${
                  multiline ? 'max-w-[min(22rem,calc(100vw-1rem))] whitespace-normal text-left leading-relaxed' : 'whitespace-nowrap leading-none'
                } bg-[#5a5fc3] dark:bg-[var(--iboard-accent,#818cf8)] dark:text-slate-950 dark:ring-white/25`
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
