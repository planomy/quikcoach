import { useEffect, useRef } from 'react';
import { clampInboxShare, INBOX_SHARE_MAX, INBOX_SHARE_MIN } from '../lib/studentSplit.js';

const WIDE_QUERY = '(min-width: 768px)';

function isWideSplit() {
  return typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches;
}

function shareFromPointer(event, grid) {
  if (!grid) return null;
  const rect = grid.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  if (isWideSplit()) {
    const writingShare = (event.clientX - rect.left) / rect.width;
    return clampInboxShare(1 - writingShare);
  }
  const inboxShare = (event.clientY - rect.top) / rect.height;
  return clampInboxShare(inboxShare);
}

/**
 * Drag gutter between writing and Inbox. Side-by-side from tablet up;
 * stacked (Inbox above writing) on phones.
 */
export default function StudentWorkspaceSplit({ share, onShare, gridRef }) {
  const draggingRef = useRef(false);

  useEffect(() => {
    function onMove(event) {
      if (!draggingRef.current) return;
      const next = shareFromPointer(event, gridRef.current);
      if (next != null) onShare(next);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.documentElement.classList.remove('iboard-student-splitting');
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.documentElement.classList.remove('iboard-student-splitting');
    };
  }, [gridRef, onShare]);

  function startDrag(event) {
    event.preventDefault();
    draggingRef.current = true;
    document.documentElement.classList.add('iboard-student-splitting');
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const next = shareFromPointer(event, gridRef.current);
    if (next != null) onShare(next);
  }

  function onKeyDown(event) {
    const step = event.shiftKey ? 0.08 : 0.04;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      onShare(share - step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      onShare(share + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onShare(INBOX_SHARE_MIN);
    } else if (event.key === 'End') {
      event.preventDefault();
      onShare(INBOX_SHARE_MAX);
    }
  }

  const percent = Math.round(share * 100);

  return (
    <div className="iboard-student-split" aria-hidden="false">
      <button
        type="button"
        className="iboard-student-split__hit"
        role="slider"
        aria-orientation="vertical"
        aria-valuemin={Math.round(INBOX_SHARE_MIN * 100)}
        aria-valuemax={Math.round(INBOX_SHARE_MAX * 100)}
        aria-valuenow={percent}
        aria-valuetext={`Inbox ${percent} percent, writing ${100 - percent} percent`}
        aria-label="Resize Inbox and writing"
        title="Drag to make Inbox or writing bigger"
        onPointerDown={startDrag}
        onKeyDown={onKeyDown}
      >
        <span className="iboard-student-split__bar" />
      </button>
    </div>
  );
}
