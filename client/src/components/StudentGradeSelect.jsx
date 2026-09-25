import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import HintWrap from './HintWrap.jsx';

/** Compact per-student year/grade options (stored as yr2…yr12). */
export const STUDENT_GRADE_OPTIONS = [
  { id: '', label: 'Year' },
  { id: 'yr2', label: 'Y2' },
  { id: 'yr3', label: 'Y3' },
  { id: 'yr4', label: 'Y4' },
  { id: 'yr5', label: 'Y5' },
  { id: 'yr6', label: 'Y6' },
  { id: 'yr7', label: 'Y7' },
  { id: 'yr8', label: 'Y8' },
  { id: 'yr9', label: 'Y9' },
  { id: 'yr10', label: 'Y10' },
  { id: 'yr11', label: 'Y11' },
  { id: 'yr12', label: 'Y12' },
];

export function gradeShortLabel(yearLevel) {
  const id = String(yearLevel || '').trim().toLowerCase();
  const hit = STUDENT_GRADE_OPTIONS.find((o) => o.id === id);
  return hit && hit.id ? hit.label : '';
}

/**
 * Themed year/grade selector (custom list — native OS menus cannot be branded).
 * @param {{ value: string, onChange: (id: string) => void, compact?: boolean, className?: string }} props
 */
export default function StudentGradeSelect({ value, onChange, compact = false, className = '' }) {
  const v = String(value || '').trim().toLowerCase();
  const selected = STUDENT_GRADE_OPTIONS.some((o) => o.id === v) ? v : '';
  const selectedLabel = STUDENT_GRADE_OPTIONS.find((o) => o.id === selected)?.label || 'Year';
  const listId = useId();
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const close = () => setOpen(false);

  const place = () => {
    const anchor = wrapRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const gap = 6;
    const pad = 8;
    const estimatedH = Math.min(320, STUDENT_GRADE_OPTIONS.length * 36 + 12);
    const spaceBelow = window.innerHeight - anchor.bottom - pad;
    const placeAbove = spaceBelow < estimatedH && anchor.top > spaceBelow;
    const width = Math.max(compact ? 72 : anchor.width, compact ? 72 : 120);
    const left = Math.min(
      Math.max(pad, compact ? anchor.left : anchor.left),
      window.innerWidth - width - pad,
    );
    const top = placeAbove
      ? Math.max(pad, anchor.top - estimatedH - gap)
      : Math.min(anchor.bottom + gap, window.innerHeight - pad);
    setBox({
      top,
      left,
      width,
      maxHeight: placeAbove
        ? Math.max(120, anchor.top - pad - gap)
        : Math.max(120, window.innerHeight - top - pad),
      placeAbove,
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onReposition = () => place();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, compact]);

  useEffect(() => {
    if (!open) return undefined;
    const idx = Math.max(0, STUDENT_GRADE_OPTIONS.findIndex((o) => o.id === selected));
    setActiveIndex(idx);
    const onPointer = (event) => {
      const t = event.target;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      close();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        wrapRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, selected]);

  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.focus({ preventScroll: true });
    const el = listRef.current.querySelector(`[data-grade-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const pick = (id) => {
    onChange?.(id);
    close();
  };

  const onTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    }
  };

  const onListKeyDown = (event) => {
    const last = STUDENT_GRADE_OPTIONS.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(last, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(last);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(STUDENT_GRADE_OPTIONS[activeIndex]?.id ?? '');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const triggerClass = compact
    ? `max-w-[3.25rem] cursor-pointer rounded border-0 bg-white/10 py-0.5 pl-1 pr-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-100 outline-none hover:bg-white/15 focus:ring-1 focus:ring-indigo-300 ${className}`
    : `box-border w-full cursor-pointer rounded-lg border border-slate-200 bg-white py-1 pl-2 pr-1 text-[11px] font-semibold text-slate-700 outline-none hover:border-indigo-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 ${className}`;

  const menu =
    open && box && typeof document !== 'undefined'
      ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Student year level"
            tabIndex={-1}
            className={`iboard-grade-menu${compact ? ' iboard-grade-menu--compact' : ''}`}
            style={{
              top: box.top,
              left: box.left,
              width: box.width,
              maxHeight: box.maxHeight,
            }}
            onKeyDown={onListKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            {STUDENT_GRADE_OPTIONS.map((o, index) => {
              const isSelected = o.id === selected;
              const isActive = index === activeIndex;
              return (
                <li key={o.id || 'none'} role="presentation">
                  <button
                    type="button"
                    role="option"
                    data-grade-index={index}
                    aria-selected={isSelected}
                    className={`iboard-grade-menu__option${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={(e) => {
                      e.stopPropagation();
                      pick(o.id);
                    }}
                  >
                    <span className="iboard-grade-menu__check" aria-hidden="true">
                      {isSelected ? '✓' : ''}
                    </span>
                    <span>{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )
      : null;

  return (
    <HintWrap hint="Student year level" prefer="above" className={compact ? '' : 'w-full'} suppressed={open}>
      <div ref={wrapRef} className={compact ? 'inline-flex' : 'block w-full'}>
        <button
          type="button"
          title=""
          aria-label="Student year level"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className={`iboard-grade-trigger ${triggerClass}`.trim()}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="iboard-grade-trigger__label">{selectedLabel}</span>
          <span className="iboard-grade-trigger__chev" aria-hidden="true" />
        </button>
        {menu}
      </div>
    </HintWrap>
  );
}
