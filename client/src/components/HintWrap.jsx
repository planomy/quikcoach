import { useLayoutEffect, useRef, useState } from 'react';
import { clampFixedBox } from '../lib/clampPopup.js';

/** Fast hover/focus hint chip — stays inside the viewport (handles top/right edges). */
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
    const width = tip.width || 80;
    const height = tip.height || 24;
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

  return (
    <span
      ref={wrapRef}
      className={`group/hint relative inline-flex ${className}`}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setShown(false);
      }}
    >
      {children}
      <span
        ref={tipRef}
        role="tooltip"
        className={`pointer-events-none fixed z-[90] whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-black leading-none text-white shadow-lg transition-opacity duration-100 dark:bg-slate-100 dark:text-slate-900 ${
          shown && pos ? 'opacity-100' : 'pointer-events-none fixed left-[-9999px] top-0 opacity-0'
        }`}
        style={shown && pos ? { top: pos.top, left: pos.left } : undefined}
      >
        {hint}
      </span>
    </span>
  );
}
