import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampFixedBox } from '../lib/clampPopup.js';

/** Fast hover/focus hint — short labels, no browser delay. Portaled so tips work inside transformed panels (e.g. Responses rail). */
export default function HintWrap({ hint, children, className = '' }) {
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!shown || !wrapRef.current || !tipRef.current || !hint) {
      setPos(null);
      return;
    }
    const anchor = wrapRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const width = Math.max(tip.width, 40);
    const height = Math.max(tip.height, 20);
    const gap = 6;
    const centerX = anchor.left + anchor.width / 2 - width / 2;
    let top = anchor.top - gap - height;
    let left = centerX;

    if (top < 10) {
      top = anchor.bottom + gap;
    }

    setPos(clampFixedBox({ top, left, width, height, padding: 8 }));
  }, [shown, hint]);

  if (!hint) return children;

  const tip = (
    <span
      ref={tipRef}
      role="tooltip"
      className={`pointer-events-none fixed z-[120] whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-black leading-none text-white shadow-lg transition-opacity duration-75 dark:bg-slate-100 dark:text-slate-900 ${
        shown && pos ? 'opacity-100' : 'left-[-9999px] top-0 opacity-0'
      }`}
      style={shown && pos ? { top: pos.top, left: pos.left } : undefined}
    >
      {hint}
    </span>
  );

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setShown(false);
      }}
    >
      {children}
      {typeof document !== 'undefined' ? createPortal(tip, document.body) : tip}
    </span>
  );
}
