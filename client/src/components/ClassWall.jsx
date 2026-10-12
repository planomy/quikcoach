import { useLayoutEffect, useRef, useState } from 'react';
import RichTextDisplay from './RichTextDisplay.jsx';

const SPAN_KEY = 'iboard-class-wall-you-span';
const OLD_HEIGHT_KEY = 'iboard-class-wall-you-height';
const GAP = 12;
const MAX_ROWS = 4;

function metrics(width) {
  const columns = width >= 1040 ? 4 : width >= 780 ? 3 : width >= 480 ? 2 : 1;
  const rowH = width >= 1040 ? 220 : width >= 780 ? 240 : width >= 480 ? 260 : 230;
  const cellW = columns <= 1 ? width : (width - GAP * (columns - 1)) / columns;
  return { columns, rowH, cellW };
}

function spanToSize(width, cols, rows) {
  const { columns, rowH, cellW } = metrics(width);
  const c = Math.min(columns, Math.max(1, cols));
  const r = Math.min(MAX_ROWS, Math.max(1, rows));
  return {
    cols: c,
    rows: r,
    w: c * cellW + (c - 1) * GAP,
    h: r * rowH + (r - 1) * GAP,
  };
}

function sizeToSpan(width, w, h) {
  const { rowH, cellW } = metrics(width);
  const cols = Math.round((w + GAP) / (cellW + GAP));
  const rows = Math.round((h + GAP) / (rowH + GAP));
  return spanToSize(width, cols, rows);
}

function clampLive(width, w, h) {
  const { rowH, cellW } = metrics(width);
  const max = spanToSize(width, 99, MAX_ROWS);
  return {
    w: Math.min(max.w, Math.max(cellW, w)),
    h: Math.min(max.h, Math.max(rowH, h)),
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.w - 0.5
    && a.x + a.w > b.x + 0.5
    && a.y < b.y + b.h - 0.5
    && a.y + a.h > b.y + 0.5;
}

function pack(width, youSize, otherCount) {
  const { columns, rowH, cellW } = metrics(width);
  const you = { x: 0, y: 0, w: youSize.w, h: youSize.h };
  const others = [];
  let row = 0;
  while (others.length < otherCount && row < 48) {
    for (let col = 0; col < columns && others.length < otherCount; col += 1) {
      const slot = {
        x: col * (cellW + GAP),
        y: row * (rowH + GAP),
        w: cellW,
        h: rowH,
      };
      if (overlaps(slot, you)) continue;
      others.push(slot);
    }
    row += 1;
  }
  const bottoms = others.map((slot) => slot.y + slot.h);
  return { you, others, height: Math.max(you.h, ...bottoms, rowH) };
}

function readSpan() {
  try {
    const saved = JSON.parse(localStorage.getItem(SPAN_KEY) || '');
    if (saved && saved.cols >= 1 && saved.rows >= 1) {
      return { cols: saved.cols, rows: saved.rows };
    }
  } catch {
    /* Keep the default card size when storage is unreadable. */
  }
  const oldHeight = Number(localStorage.getItem(OLD_HEIGHT_KEY));
  if (oldHeight >= 144) return { cols: 1, rows: Math.min(MAX_ROWS, Math.max(1, Math.round(oldHeight / 230))) };
  return { cols: 1, rows: 1 };
}

function storeSpan(span) {
  localStorage.setItem(SPAN_KEY, JSON.stringify({ cols: span.cols, rows: span.rows }));
  localStorage.removeItem(OLD_HEIGHT_KEY);
}

function wallName(student, { you, hideNames }) {
  if (you) return 'You';
  if (hideNames) return 'Classmate';
  return String(student?.name || 'Student').trim() || 'Student';
}

export default function ClassWall({
  students = [],
  selfId,
  hideNames = false,
  youCard,
}) {
  const wallRef = useRef(null);
  const liveRef = useRef(null);
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [span, setSpan] = useState(readSpan);
  const [live, setLive] = useState(null);
  const ordered = [...students].sort((left, right) => {
    const leftYou = Number(left.id) === Number(selfId);
    const rightYou = Number(right.id) === Number(selfId);
    if (leftYou !== rightYou) return leftYou ? -1 : 1;
    return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
  });
  const hasYou = ordered.some((student) => Number(student.id) === Number(selfId));

  useLayoutEffect(() => {
    const node = wallRef.current;
    if (!node) return undefined;
    const measure = () => {
      const next = node.clientWidth;
      widthRef.current = next;
      setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fitted = width ? spanToSize(width, span.cols, span.rows) : null;
  const youSize = width
    ? (live ? clampLive(width, live.w, live.h) : { w: fitted.w, h: fitted.h })
    : null;
  const layout = width && hasYou
    ? pack(width, youSize, ordered.length - 1)
    : (width ? pack(width, { w: 0, h: 0 }, ordered.length) : null);

  function remember(next) {
    const snapped = spanToSize(widthRef.current || width, next.cols, next.rows);
    const stored = { cols: snapped.cols, rows: snapped.rows };
    setSpan(stored);
    storeSpan(stored);
  }

  function onGripPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    if (!youSize) return;
    event.preventDefault();
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* Capture is unavailable for this pointer; move events still land on the handle. */
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const originW = youSize.w;
    const originH = youSize.h;
    const pointerId = event.pointerId;
    const move = (e) => {
      if (e.pointerId !== pointerId) return;
      const next = clampLive(widthRef.current, originW + (e.clientX - startX), originH + (e.clientY - startY));
      liveRef.current = next;
      setLive(next);
    };
    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      const current = liveRef.current || { w: originW, h: originH };
      liveRef.current = null;
      setLive(null);
      remember(sizeToSpan(widthRef.current, current.w, current.h));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onGripKeyDown(event) {
    const horizontal = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const vertical = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!horizontal && !vertical) return;
    event.preventDefault();
    const step = event.shiftKey ? 2 : 1;
    remember({ cols: span.cols + horizontal * step, rows: span.rows + vertical * step });
  }

  let otherSlot = 0;
  return (
    <div
      ref={wallRef}
      className={`iboard-class-wall${layout ? ' is-packed' : ''}`}
      style={layout ? { height: layout.height } : undefined}
      role="list"
      aria-label="Class writing wall"
    >
      {ordered.map((student) => {
        const you = Number(student.id) === Number(selfId);
        const hasWriting = Boolean(String(student.text || '').trim() || String(student.rich_text_html || '').trim());
        const box = layout ? (you ? layout.you : layout.others[otherSlot++]) : null;
        return (
          <article
            key={student.id}
            role="listitem"
            className={`iboard-class-wall__card${you ? ' is-you' : ''}`}
            style={box ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined}
          >
            <header className="iboard-class-wall__head">
              <p className="iboard-class-wall__name">{wallName(student, { you, hideNames })}</p>
            </header>
            <div className="iboard-class-wall__body">
              {you ? youCard : (
                <>
                  {student.image_url ? (
                    <img src={student.image_url} alt="" className="iboard-class-wall__image" />
                  ) : null}
                  {hasWriting ? (
                    <RichTextDisplay html={student.rich_text_html} text={student.text || ''} />
                  ) : (
                    <span className="iboard-class-wall__empty">No writing yet</span>
                  )}
                </>
              )}
            </div>
            {you ? (
              <button
                type="button"
                className="iboard-class-wall__grip"
                aria-label="Drag to resize your card"
                onPointerDown={onGripPointerDown}
                onKeyDown={onGripKeyDown}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M10.5 4.5 L4.5 10.5" />
                  <path d="M10.5 8 L8 10.5" />
                </svg>
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
