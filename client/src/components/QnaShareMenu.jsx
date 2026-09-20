import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Share ▾ Named / Anonymous — portaled so dock overflow cannot clip the menu.
 */
export default function QnaShareMenu({
  onShare,
  anonymityLocked = false,
  disabled = false,
  className = '',
  summaryClassName = '',
}) {
  const detailsRef = useRef(null);
  const summaryRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);

  function placeMenu() {
    const summary = summaryRef.current;
    if (!summary || typeof window === 'undefined') return;
    const rect = summary.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight || 88;
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + gap + 8;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 140));
    if (openUp) {
      setBox({
        left,
        bottom: Math.max(8, window.innerHeight - rect.top + gap),
        top: 'auto',
      });
    } else {
      setBox({
        left,
        top: rect.bottom + gap,
        bottom: 'auto',
      });
    }
  }

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return undefined;
    }
    placeMenu();
    const onReposition = () => placeMenu();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      const details = detailsRef.current;
      const menu = menuRef.current;
      if (details?.contains(event.target) || menu?.contains(event.target)) return;
      details?.removeAttribute('open');
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      detailsRef.current?.removeAttribute('open');
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(anonymous) {
    if (!anonymous && anonymityLocked) return;
    detailsRef.current?.removeAttribute('open');
    setOpen(false);
    onShare?.(anonymous);
  }

  return (
    <details
      ref={detailsRef}
      className={`relative z-20 ${className}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        ref={summaryRef}
        className={`list-none cursor-pointer [&::-webkit-details-marker]:hidden ${
          disabled ? 'pointer-events-none opacity-40' : ''
        } ${summaryClassName}`}
      >
        Share ▾
      </summary>
      {open && box && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Share question"
              className="fixed z-[120] min-w-32 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
              style={{ left: box.left, top: box.top, bottom: box.bottom }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={anonymityLocked}
                title={
                  anonymityLocked
                    ? 'Student asked to stay anonymous if shared'
                    : 'Share with the student named'
                }
                onClick={() => choose(false)}
                className={`block w-full rounded-md px-3 py-2 text-left text-xs font-bold ${
                  anonymityLocked
                    ? 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                Named
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(true)}
                className="block w-full rounded-md px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Anonymous
              </button>
            </div>,
            document.body
          )
        : null}
    </details>
  );
}
