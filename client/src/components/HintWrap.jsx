import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges } from '../lib/viewport.js';

const HINT_PAD = 8;
const EST_HEIGHT = 22;

function measureAndPlace(wrapEl, tipEl, hint, prefer) {
  const anchor = wrapEl?.getBoundingClientRect();
  if (!anchor) return null;
  const width = tipEl?.offsetWidth || Math.max(48, String(hint).length * 7 + 16);
  const height = tipEl?.offsetHeight || EST_HEIGHT;
  return placementNearAnchor({
    anchor,
    width,
    height,
    gap: 6,
    padding: HINT_PAD,
    prefer,
  });
}

/** Fast hover/focus hint chip — flips below when there isn’t room above. */
export default function HintWrap({ hint, children, className = '', prefer = 'above' }) {
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);

  useEffect(() => {
    if (!open || !hint) {
      setBox(null);
      return undefined;
    }

    const place = () => {
      setBox(measureAndPlace(wrapRef.current, tipRef.current, hint, prefer));
    };

    place();
    const frame = requestAnimationFrame(place);
    const unsubscribe = subscribeViewportChanges(place);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [open, hint, prefer]);

  if (!hint) return children;

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {children}
      {open && typeof document !== 'undefined' && createPortal(
        <span
          ref={tipRef}
          role="tooltip"
          className="pointer-events-none fixed z-[200] whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-black leading-none text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
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
