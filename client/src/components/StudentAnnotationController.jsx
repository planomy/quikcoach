import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plainTextFromElement, rangeForPlainOffsets, resolveAnnotation } from '../lib/annotations.js';
import { clampFixedBox, placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges, viewportBox } from '../lib/viewport.js';

const HIGHLIGHT_NAME = 'iboard-student-inline-comments';
const FIXED_HIGHLIGHT_NAME = 'iboard-student-fixed-comments';
const MARKER_SIZE = 28;
const MARKER_MARGIN = 6;
const POPUP_WIDTH = 320;
/** Placement budget — keep the action button visible on short iPad viewports. */
const POPUP_HEIGHT = 360;

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
  let top = rangeRect.top - MARKER_SIZE + 10;
  const left = rangeRect.right - MARKER_SIZE * 0.45;
  if (top < viewportBox().top + MARKER_MARGIN) top = rangeRect.top - 4;
  return clampFixedBox({
    top,
    left,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    padding: MARKER_MARGIN,
  });
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

function commentPopupMaxHeight() {
  const vp = viewportBox();
  return Math.max(220, Math.min(POPUP_HEIGHT, vp.height - 24));
}

function commentPopupPosition(marker) {
  const height = commentPopupMaxHeight();
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
    height,
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

  useEffect(() => {
    if (!openMarker) return undefined;
    function onMouseDown(event) {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.('[data-teacher-annotation-ui]')) return;
      setOpenMarker(null);
      setActionError('');
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openMarker]);

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
        ::highlight(${HIGHLIGHT_NAME}) { background: rgba(90, 95, 195, 0.18); text-decoration: underline 2px #5a5fc3; text-underline-offset: 2px; }
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
          className={`fixed z-[50] flex h-7 w-7 items-center justify-center rounded-full text-xs font-black text-white shadow-md transition ${
            marker.annotation.status === 'fixed'
              ? 'bg-emerald-500/30 hover:bg-emerald-500/50'
              : 'bg-[#5a5fc3]/30 hover:bg-[#5a5fc3]/50'
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
          className="fixed z-[70] flex w-[320px] flex-col overflow-hidden rounded-2xl border border-[#d5d4e4] bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
          style={{
            top: openPopupPosition.top,
            left: openPopupPosition.left,
            maxHeight: commentPopupMaxHeight(),
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-2">
            {openMarker.annotation.status === 'fixed' ? null : openMarker.annotation.student_fixed_at ? (
              <p className="mb-1.5 text-sm font-semibold text-[#3c3c45] dark:text-slate-100">
                Check this again please
              </p>
            ) : (
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.13em] text-[#5a5fc3] dark:text-indigo-300">
                Teacher comment
              </p>
            )}
            {openMarker.annotation.status !== 'fixed' && (
              <p className="line-clamp-3 text-xs italic text-[#52525c] dark:text-slate-400">
                “{openMarker.annotation.quote}”
              </p>
            )}
            <p className={`${openMarker.annotation.status === 'fixed' ? '' : 'mt-2'} whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-[#3c3c45] dark:text-slate-100`}>
              {typeof openMarker.annotation.note === 'string' ? openMarker.annotation.note : ''}
            </p>
            {openMarker.detached && openMarker.annotation.status !== 'fixed' && (
              <div className="mt-2.5 rounded-xl border border-[#cfcce8] bg-[#ebeaf8] px-2.5 py-2 text-xs font-semibold text-[#3c3c45] dark:border-indigo-900 dark:bg-indigo-950/35 dark:text-indigo-100">
                Your edit changed the highlighted passage. Check the comment, then mark it when you are happy.
              </div>
            )}
            {actionError && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{actionError}</p>}
          </div>
          <div className="shrink-0 border-t border-[#e4e4ea] bg-[#fafafc] p-3 dark:border-slate-700 dark:bg-slate-950/40">
            {openMarker.annotation.status === 'fixed' ? (
              <p className="rounded-xl border border-[#cfcce8] bg-[#ebeaf8] px-3 py-2 text-xs font-semibold text-[#5a5fc3] dark:border-indigo-900 dark:bg-indigo-950/35 dark:text-indigo-200">
                Waiting for your teacher
              </p>
            ) : (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => markCommentFixed(openMarker)}
                className="w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {actionBusy ? 'Saving…' : 'I’ve checked this'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
