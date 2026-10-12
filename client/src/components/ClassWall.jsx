import { useEffect, useRef } from 'react';
import RichTextDisplay from './RichTextDisplay.jsx';

const YOU_HEIGHT_KEY = 'iboard-class-wall-you-height';

function clampCardHeight(node, px) {
  const style = getComputedStyle(node);
  const min = parseFloat(style.minHeight) || 144;
  const max = parseFloat(style.maxHeight) || 640;
  return Math.round(Math.min(max, Math.max(min, px)));
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
  const youRef = useRef(null);
  const ordered = [...students].sort((left, right) => {
    const leftYou = Number(left.id) === Number(selfId);
    const rightYou = Number(right.id) === Number(selfId);
    if (leftYou !== rightYou) return leftYou ? -1 : 1;
    return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
  });

  useEffect(() => {
    const node = youRef.current;
    if (!node) return undefined;
    const saved = Number(localStorage.getItem(YOU_HEIGHT_KEY));
    if (saved >= 144 && saved <= 900) node.style.height = `${Math.round(saved)}px`;
    const observer = new ResizeObserver(() => {
      const height = Math.round(node.getBoundingClientRect().height);
      if (height >= 144) localStorage.setItem(YOU_HEIGHT_KEY, String(height));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [selfId, ordered.length]);

  function onGripPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const node = youRef.current;
    const handle = event.currentTarget;
    if (!node) return;
    event.preventDefault();
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* Capture is unavailable for this pointer; move events still land on the handle. */
    }
    const startY = event.clientY;
    const startH = node.getBoundingClientRect().height;
    const move = (e) => {
      node.style.height = `${clampCardHeight(node, startH + (e.clientY - startY))}px`;
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function onGripKeyDown(event) {
    const node = youRef.current;
    if (!node) return;
    const step = event.shiftKey ? 48 : 16;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? step : -step;
    node.style.height = `${clampCardHeight(node, node.getBoundingClientRect().height + delta)}px`;
  }

  return (
    <div className="iboard-class-wall" role="list" aria-label="Class writing wall">
      {ordered.map((student) => {
        const you = Number(student.id) === Number(selfId);
        const hasWriting = Boolean(String(student.text || '').trim() || String(student.rich_text_html || '').trim());
        return (
          <article
            key={student.id}
            role="listitem"
            ref={you ? youRef : undefined}
            className={`iboard-class-wall__card${you ? ' is-you' : ''}`}
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
                aria-label="Drag to resize your writing box"
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
