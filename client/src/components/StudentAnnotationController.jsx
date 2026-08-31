import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plainTextFromElement, rangeForPlainOffsets, resolveAnnotation } from '../lib/annotations.js';
import { clampFixedBox, placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges, viewportBox } from '../lib/viewport.js';

const HIGHLIGHT_NAME = 'iboard-student-inline-comments';
const FIXED_HIGHLIGHT_NAME = 'iboard-student-fixed-comments';
const MARKER_SIZE = 28;
const MARKER_GAP = 5;
const MARKER_MARGIN = 6;
const POPUP_WIDTH = 290;
const POPUP_HEIGHT = 220;

function currentStudentId() {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = sessionStorage.getItem('quik-coach-student') || localStorage.getItem('quik-coach-student') || '';
    const parsed = raw ? JSON.parse(raw) : null;
    return Number(parsed?.studentId) || 0;
  } catch {
    return 0;
  }
}

function editorElement() {
  return document.querySelector('[role="textbox"][contenteditable]');
}

function markerPosition(rangeRect) {
  const clamped = clampFixedBox({
    top: rangeRect.top - 2,
    left: rangeRect.right + MARKER_GAP,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    padding: MARKER_MARGIN,
  });
  return clamped;
}

function detachedMarkerPosition(editorRect, index) {
  const vp = viewportBox();
  return clampFixedBox({
    top: editorRect.top + 8 + index * (MARKER_SIZE + 4),
    left: editorRect.right - MARKER_SIZE - 6,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    padding: MARKER_MARGIN,
  });
}

function commentPopupPosition(marker) {
  return placementNearAnchor({
    anchor: {
      top: marker.top,
      left: marker.left,
      right: marker.left + MARKER_SIZE,
      bottom: marker.top + MARKER_SIZE,
      width: MARKER_SIZE,
      height: MARKER_SIZE,
    },
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    gap: 10,
    prefer: 'below',
  });
}

export default function StudentAnnotationController({ socket, studentId: suppliedStudentId }) {
  const studentId = Number(suppliedStudentId) || currentStudentId();
  const [annotations, setAnnotations] = useState([]);
  const [markers, setMarkers] = useState([]);
  const [openMarker, setOpenMarker] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const moveFrameRef = useRef(null);

  const refreshHighlights = useCallback(() => {
    if (typeof document === 'undefined') return;
    const editor = editorElement();
    if (!editor) {
      globalThis.CSS?.highlights?.delete?.(HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(FIXED_HIGHLIGHT_NAME);
      setMarkers([]);
      return;
    }
    const text = plainTextFromElement(editor);
    const ranges = [];
    const fixedRanges = [];
    const nextMarkers = [];
    let detachedCount = 0;
    const editorRect = editor.getBoundingClientRect();
    const vp = viewportBox();
    const editorVisible =
      editorRect.bottom > vp.top &&
      editorRect.top < vp.top + vp.height &&
      editorRect.right > vp.left &&
      editorRect.left < vp.left + vp.width;
    for (const annotation of annotations || []) {
      const fixed = annotation.status === 'fixed';
      const resolved = resolveAnnotation(annotation, text);
      const range = resolved.detached ? null : rangeForPlainOffsets(editor, resolved.start, resolved.end);
      if (!range) {
        if (editorVisible) {
          const pos = detachedMarkerPosition(editorRect, detachedCount);
          nextMarkers.push({
            annotation,
            detached: true,
            top: pos.top,
            left: pos.left,
          });
          detachedCount += 1;
        }
        continue;
      }
      (fixed ? fixedRanges : ranges).push(range);
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) {
        const pos = markerPosition(rect);
        nextMarkers.push({
          annotation,
          detached: false,
          top: pos.top,
          left: pos.left,
        });
      }
    }
    if (globalThis.CSS?.highlights && typeof globalThis.Highlight !== 'undefined') {
      if (ranges.length) globalThis.CSS.highlights.set(HIGHLIGHT_NAME, new globalThis.Highlight(...ranges));
      else globalThis.CSS.highlights.delete(HIGHLIGHT_NAME);
      if (fixedRanges.length) globalThis.CSS.highlights.set(FIXED_HIGHLIGHT_NAME, new globalThis.Highlight(...fixedRanges));
      else globalThis.CSS.highlights.delete(FIXED_HIGHLIGHT_NAME);
    }
    setMarkers(nextMarkers);
  }, [annotations]);

  useEffect(() => {
    if (!socket) return;
    let cancelled = false;
    let retryTimer = null;
    const onMine = ({ studentId: incomingId, annotations: list }) => {
      const id = Number(incomingId) || currentStudentId();
      if (studentId && id && id !== Number(studentId)) return;
      setAnnotations(Array.isArray(list) ? list : []);
    };
    const onUpdate = ({ studentId: incomingId, annotations: list }) => {
      const mine = currentStudentId() || studentId;
      if (mine && Number(incomingId) !== Number(mine)) return;
      setAnnotations(Array.isArray(list) ? list : []);
    };
    const schedule = () => requestAnimationFrame(() => requestAnimationFrame(refreshHighlights));
    const queueSync = (delay = 0, attempt = 0) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => sync(attempt), delay);
    };
    const sync = (attempt = 0) => {
      if (cancelled) return;
      socket.emit('student:annotations-sync', {}, (ack) => {
        if (cancelled) return;
        if (!ack?.ok) {
          // The socket often connects just before student:join/rejoin has assigned its
          // identity. Retry until that join has completed instead of losing the mailbox.
          if (attempt < 30) queueSync(100, attempt + 1);
          return;
        }
        onMine(ack);
        schedule();
      });
    };
    const onRoomState = () => {
      schedule();
      // room:state is emitted after a successful join/rejoin, so it is the most reliable
      // point to recover comments that arrived while the student page was starting.
      queueSync();
    };
    const requestSync = () => queueSync();
    socket.on('teacher-annotations:mine', onMine);
    socket.on('teacher-annotations:update', onUpdate);
    socket.on('room:state', onRoomState);
    socket.on('connect', requestSync);
    queueSync();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket.off('teacher-annotations:mine', onMine);
      socket.off('teacher-annotations:update', onUpdate);
      socket.off('room:state', onRoomState);
      socket.off('connect', requestSync);
    };
  }, [socket, studentId, refreshHighlights]);

  useEffect(() => {
    const schedule = () => {
      if (moveFrameRef.current != null) return;
      moveFrameRef.current = requestAnimationFrame(() => {
        moveFrameRef.current = null;
        refreshHighlights();
      });
    };
    let observedEditor = null;
    const observer = new MutationObserver(() => {
      const nextEditor = editorElement();
      if (nextEditor && nextEditor !== observedEditor) {
        observer.disconnect();
        observedEditor = nextEditor;
        observer.observe(nextEditor, { childList: true, subtree: true, characterData: true });
      }
      schedule();
    });
    const attachObserver = () => {
      const nextEditor = editorElement();
      if (nextEditor === observedEditor) return;
      observer.disconnect();
      observedEditor = nextEditor;
      if (nextEditor) {
        observer.observe(nextEditor, { childList: true, subtree: true, characterData: true });
      } else if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
      schedule();
    };
    const onInput = (event) => {
      if (event.target?.matches?.('[role="textbox"][contenteditable]')) schedule();
    };
    document.addEventListener('input', onInput, true);
    const unsubscribe = subscribeViewportChanges(schedule);
    window.addEventListener('iboard:room-state', attachObserver);
    attachObserver();
    const id = requestAnimationFrame(() => requestAnimationFrame(refreshHighlights));
    return () => {
      cancelAnimationFrame(id);
      observer.disconnect();
      document.removeEventListener('input', onInput, true);
      unsubscribe();
      window.removeEventListener('iboard:room-state', attachObserver);
      if (moveFrameRef.current != null) cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
      globalThis.CSS?.highlights?.delete?.(HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(FIXED_HIGHLIGHT_NAME);
    };
  }, [refreshHighlights]);

  useEffect(() => {
    if (!openMarker) return;
    const current = markers.find(
      (marker) => Number(marker.annotation?.id) === Number(openMarker.annotation?.id)
    );
    if (!current) {
      setOpenMarker(null);
      return;
    }
    if (current.top !== openMarker.top || current.left !== openMarker.left) {
      setOpenMarker(current);
    }
  }, [markers, openMarker]);

  const openPopupPosition = useMemo(
    () => (openMarker ? commentPopupPosition(openMarker) : null),
    [openMarker]
  );

  function markCommentFixed(marker) {
    if (!socket || !marker?.annotation?.id || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    socket.emit('student:annotation-fixed', { annotationId: marker.annotation.id }, (ack) => {
      setActionBusy(false);
      if (!ack?.ok) {
        setActionError(ack?.error || 'Could not mark this comment as fixed');
        return;
      }
      setOpenMarker(null);
    });
  }

  return (
    <>
      <style>{`
        ::highlight(${HIGHLIGHT_NAME}) { background: rgba(196, 181, 253, 0.78); text-decoration: underline 2px rgb(124, 58, 237); text-underline-offset: 2px; }
        ::highlight(${FIXED_HIGHLIGHT_NAME}) { background: rgba(167, 243, 208, 0.62); text-decoration: underline 2px rgb(16, 185, 129); text-underline-offset: 2px; }
      `}</style>
      {markers.map((marker) => (
        <button
          key={marker.annotation.id}
          data-teacher-annotation-ui
          type="button"
          onClick={() => {
            setActionError('');
            setOpenMarker(marker);
          }}
          className={`fixed z-[50] flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-black text-white shadow-lg transition ${
            marker.annotation.status === 'fixed'
              ? 'bg-emerald-500/80 hover:bg-emerald-600'
              : 'bg-violet-600 hover:bg-violet-700'
          }`}
          style={{ top: marker.top, left: marker.left }}
          title={marker.annotation.status === 'fixed' ? 'Marked fixed — waiting for teacher' : 'Teacher comment'}
          aria-label={marker.annotation.status === 'fixed' ? 'Comment marked fixed' : 'Open teacher comment'}
        >
          {marker.annotation.status === 'fixed' ? '✓' : '💬'}
        </button>
      ))}
      {openMarker && openPopupPosition && (
        <div
          data-teacher-annotation-ui
          className="fixed z-[70] w-[290px] rounded-2xl border border-violet-200 bg-white p-4 shadow-2xl dark:border-violet-800 dark:bg-slate-900"
          style={{ top: openPopupPosition.top, left: openPopupPosition.left }}
        >
          <button
            type="button"
            onClick={() => setOpenMarker(null)}
            className="float-right text-lg font-black text-slate-400 hover:text-slate-700"
            aria-label="Close teacher comment"
            title="Close comment"
          >
            ×
          </button>
          <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${
            openMarker.annotation.status === 'fixed'
              ? 'text-emerald-600 dark:text-emerald-300'
              : 'text-violet-600 dark:text-violet-300'
          }`}>
            {openMarker.annotation.status === 'fixed' ? 'Marked as fixed' : 'Teacher comment'}
          </p>
          <p className="mt-1 line-clamp-2 text-xs italic text-slate-500 dark:text-slate-400">“{openMarker.annotation.quote}”</p>
          <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-800 dark:text-slate-100">{openMarker.annotation.note}</p>
          {openMarker.detached && openMarker.annotation.status !== 'fixed' && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Your edit changed the highlighted passage. Check the teacher comment, then mark it fixed when you are happy.
            </p>
          )}
          {actionError && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{actionError}</p>}
          {openMarker.annotation.status === 'fixed' ? (
            <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
              Your teacher can now check the change.
            </p>
          ) : (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => markCommentFixed(openMarker)}
              className="mt-3 w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {actionBusy ? 'Marking…' : 'I’ve fixed this'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
