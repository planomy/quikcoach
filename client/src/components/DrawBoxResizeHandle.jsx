import { useEffect, useRef } from 'react';

export const DRAW_BOX_MIN = 200;
export const DRAW_BOX_MAX = 880;
export const DRAW_BOX_DEFAULT = 360;
export const DRAW_BOX_HEIGHT_KEY = 'iboard-draw-box-height';

export function clampDrawBoxHeight(value) {
  const max = typeof window === 'undefined'
    ? DRAW_BOX_MAX
    : Math.min(DRAW_BOX_MAX, Math.round(window.innerHeight * 0.78));
  return Math.min(max, Math.max(DRAW_BOX_MIN, Math.round(value)));
}

export function readDrawBoxHeight() {
  if (typeof sessionStorage === 'undefined') return DRAW_BOX_DEFAULT;
  const raw = Number(sessionStorage.getItem(DRAW_BOX_HEIGHT_KEY));
  if (!Number.isFinite(raw)) return DRAW_BOX_DEFAULT;
  return clampDrawBoxHeight(raw);
}

export function persistDrawBoxHeight(value) {
  const next = clampDrawBoxHeight(value);
  try {
    sessionStorage.setItem(DRAW_BOX_HEIGHT_KEY, String(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}

export default function DrawBoxResizeHandle({ height, disabled = false, onHeight, onResizeEnd }) {
  const heightRef = useRef(height);

  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  function startResize(event) {
    if (disabled || (event.button != null && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const originY = event.clientY;
    const originH = heightRef.current;
    document.documentElement.classList.add('iboard-draw-resizing');

    function move(nextEvent) {
      const next = persistDrawBoxHeight(originH + (nextEvent.clientY - originY));
      heightRef.current = next;
      onHeight?.(next);
    }

    function up() {
      document.documentElement.classList.remove('iboard-draw-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onResizeEnd?.();
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function onKeyDown(event) {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = persistDrawBoxHeight(heightRef.current + (event.key === 'ArrowDown' ? 48 : -48));
      heightRef.current = next;
      onHeight?.(next);
    }
  }

  return (
    <button
      type="button"
      className="iboard-draw-pad__resize"
      aria-label="Drag to give the drawing more vertical room"
      aria-orientation="horizontal"
      disabled={disabled}
      onPointerDown={startResize}
      onKeyDown={onKeyDown}
    >
      <span className="iboard-draw-pad__resize-bar" aria-hidden="true" />
    </button>
  );
}
