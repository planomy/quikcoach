import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  commentTone,
  inferReplacementPassage,
  locateAnnotationRange,
  plainTextFromElement,
} from '../lib/annotations.js';
import { placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges, viewportBox } from '../lib/viewport.js';
import AnnotationMark from './AnnotationMark.jsx';

const HIGHLIGHT_NAME = 'iboard-student-inline-comments';
const REOPEN_HIGHLIGHT_NAME = 'iboard-student-reopen-comments';
const AWAITING_HIGHLIGHT_NAME = 'iboard-student-awaiting-comments';
const RESOLVED_HIGHLIGHT_NAME = 'iboard-student-resolved-comments';
const MARKER_SIZE = 20;
const MARKER_MARGIN = 6;
const POPUP_WIDTH = 320;
/** Placement budget — keep the action button visible on short iPad viewports. */
const POPUP_HEIGHT = 360;
const AUTO_FIX_DELAY_MS = 700;

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

function clampOnScreen({ top, left, width, height, padding = MARKER_MARGIN }) {
  const maxTop = (typeof window !== 'undefined' ? window.innerHeight : 800) - height - padding;
  const maxLeft = (typeof window !== 'undefined' ? window.innerWidth : 1200) - width - padding;
  return {
    top: Math.max(padding, Math.min(maxTop, top)),
    left: Math.max(padding, Math.min(maxLeft, left)),
  };
}

function markerPosition(rangeRect, editorRect) {
  const top = rangeRect.top + (rangeRect.height - MARKER_SIZE) / 2;
  const left = (editorRect?.right || rangeRect.right + 8) - MARKER_SIZE - 8;
  return clampOnScreen({
    top,
    left,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
  });
}

function detachedMarkerPosition(editorRect, index) {
  return clampOnScreen({
    top: editorRect.top + 8 + index * (MARKER_SIZE + 4),
    left: editorRect.right - MARKER_SIZE - 6,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
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
  const [editorTextTick, setEditorTextTick] = useState(0);
  const moveFrameRef = useRef(null);
  const autoFixQueuedRef = useRef(new Set());
  const autoFixTimersRef = useRef(new Map());
  const checkAgainSnapshotRef = useRef(new Map());
  const prevToneRef = useRef(new Map());

  const refreshHighlights = useCallback(() => {
    if (typeof document === 'undefined') return;
    const editor = editorElement();
    if (!editor) {
      globalThis.CSS?.highlights?.delete?.(HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(REOPEN_HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(AWAITING_HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(RESOLVED_HIGHLIGHT_NAME);
      setMarkers([]);
      return;
    }
    const text = plainTextFromElement(editor);
    const ranges = [];
    const reopenRanges = [];
    const awaitingRanges = [];
    const resolvedRanges = [];
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
      const { resolved, range } = locateAnnotationRange(editor, annotation, text);
      const tone = commentTone(annotation, resolved.detached);
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
      if (tone === 'resolved') resolvedRanges.push(range);
      else if (tone === 'fixed') awaitingRanges.push(range);
      else if (tone === 'reopen') reopenRanges.push(range);
      else ranges.push(range);
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) {
        const pos = markerPosition(rect, editorRect);
        nextMarkers.push({
          annotation,
          detached: resolved.detached,
          top: pos.top,
          left: pos.left,
        });
      }
    }
    if (globalThis.CSS?.highlights && typeof globalThis.Highlight !== 'undefined') {
      if (ranges.length) globalThis.CSS.highlights.set(HIGHLIGHT_NAME, new globalThis.Highlight(...ranges));
      else globalThis.CSS.highlights.delete(HIGHLIGHT_NAME);
      if (reopenRanges.length) {
        globalThis.CSS.highlights.set(REOPEN_HIGHLIGHT_NAME, new globalThis.Highlight(...reopenRanges));
      } else globalThis.CSS.highlights.delete(REOPEN_HIGHLIGHT_NAME);
      if (awaitingRanges.length) {
        globalThis.CSS.highlights.set(AWAITING_HIGHLIGHT_NAME, new globalThis.Highlight(...awaitingRanges));
      } else globalThis.CSS.highlights.delete(AWAITING_HIGHLIGHT_NAME);
      if (resolvedRanges.length) {
        globalThis.CSS.highlights.set(RESOLVED_HIGHLIGHT_NAME, new globalThis.Highlight(...resolvedRanges));
      } else globalThis.CSS.highlights.delete(RESOLVED_HIGHLIGHT_NAME);
    }
    setMarkers(nextMarkers);
  }, [annotations]);

  useEffect(() => {
    const editor = editorElement();
    const text = editor ? plainTextFromElement(editor) : '';
    const seen = new Set();
    for (const annotation of annotations || []) {
      const id = Number(annotation.id);
      if (!id) continue;
      seen.add(id);
      const tone = commentTone(annotation);
      const prev = prevToneRef.current.get(id);
      if (tone === 'reopen' && prev !== 'reopen') {
        autoFixQueuedRef.current.delete(id);
        checkAgainSnapshotRef.current.set(id, text);
      }
      if (tone !== 'reopen') checkAgainSnapshotRef.current.delete(id);
      prevToneRef.current.set(id, tone);
    }
    for (const id of [...prevToneRef.current.keys()]) {
      if (!seen.has(id)) {
        prevToneRef.current.delete(id);
        checkAgainSnapshotRef.current.delete(id);
        autoFixQueuedRef.current.delete(id);
      }
    }
  }, [annotations]);

  const markCommentFixed = useCallback(
    (annotationId, { closePopup = false } = {}) => {
      const id = Number(annotationId);
      if (!socket || !id) return;
      setAnnotations((prev) =>
        prev.map((item) =>
          Number(item.id) === id
            ? {
                ...item,
                status: 'fixed',
                student_fixed_at: item.student_fixed_at || new Date().toISOString(),
              }
            : item
        )
      );
      if (closePopup) setOpenMarker(null);
      socket.emit('student:annotation-fixed', { annotationId: id }, (ack) => {
        if (ack?.ok) return;
        setActionError(ack?.error || 'Could not mark this comment as fixed');
        autoFixQueuedRef.current.delete(id);
        socket.emit('student:annotations-sync', {}, (syncAck) => {
          if (syncAck?.ok && Array.isArray(syncAck.annotations)) {
            setAnnotations(syncAck.annotations);
          }
        });
      });
    },
    [socket]
  );

  useEffect(() => {
    if (!socket) return;
    const timers = autoFixTimersRef.current;
    const queued = autoFixQueuedRef.current;
    const editor = editorElement();
    const liveText = editor ? plainTextFromElement(editor) : '';
    for (const marker of markers) {
      const id = Number(marker.annotation?.id);
      if (!id) continue;
      const persisted = commentTone(marker.annotation);
      const snapshot = checkAgainSnapshotRef.current.get(id);
      const shouldAuto =
        (persisted === 'open' && marker.detached) ||
        (persisted === 'reopen' && snapshot != null && liveText !== snapshot);
      if (!shouldAuto) {
        const pending = timers.get(id);
        if (pending) {
          clearTimeout(pending);
          timers.delete(id);
        }
        continue;
      }
      if (queued.has(id) || timers.has(id)) continue;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          if (queued.has(id)) return;
          queued.add(id);
          markCommentFixed(id);
        }, AUTO_FIX_DELAY_MS)
      );
    }
    return undefined;
  }, [markers, socket, markCommentFixed, annotations, editorTextTick]);

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
      for (const timer of autoFixTimersRef.current.values()) clearTimeout(timer);
      autoFixTimersRef.current.clear();
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
      if (event.target?.matches?.('[role="textbox"][contenteditable]')) {
        schedule();
        setEditorTextTick((n) => n + 1);
      }
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
      globalThis.CSS?.highlights?.delete?.(REOPEN_HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(AWAITING_HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(RESOLVED_HIGHLIGHT_NAME);
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
    if (
      current.top !== openMarker.top ||
      current.left !== openMarker.left ||
      current.detached !== openMarker.detached ||
      current.annotation?.status !== openMarker.annotation?.status
    ) {
      setOpenMarker(current);
    }
  }, [markers, openMarker]);

  const openPopupPosition = useMemo(
    () => (openMarker ? commentPopupPosition(openMarker) : null),
    [openMarker]
  );

  const openMarkerChange = useMemo(() => {
    if (!openMarker?.detached || !openMarker.annotation) return null;
    const editor = editorElement();
    if (!editor) return null;
    return inferReplacementPassage(openMarker.annotation, plainTextFromElement(editor));
  }, [openMarker]);

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

  function markCommentFixedManual(marker) {
    if (!marker?.annotation?.id || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    autoFixQueuedRef.current.add(Number(marker.annotation.id));
    markCommentFixed(marker.annotation.id, { closePopup: true });
    setActionBusy(false);
  }

  const openTone = commentTone(openMarker?.annotation, openMarker?.detached);
  const showChangedPassage = !!openMarker?.detached;
  const openLiveText = editorElement() ? plainTextFromElement(editorElement()) : '';
  const reopenSnapshot = openMarker
    ? checkAgainSnapshotRef.current.get(Number(openMarker.annotation?.id))
    : null;
  const needsManualCheck =
    (openTone === 'open' && !openMarker?.detached) ||
    (openTone === 'reopen' && (reopenSnapshot == null || openLiveText === reopenSnapshot));

  return (
    <>
      <style>{`
        ::highlight(${HIGHLIGHT_NAME}) { background: rgba(90, 95, 195, 0.18); text-decoration: underline 2px #5a5fc3; text-underline-offset: 2px; }
        ::highlight(${REOPEN_HIGHLIGHT_NAME}) { background: rgba(248, 113, 113, 0.18); text-decoration: underline 2px #f87171; text-underline-offset: 2px; }
        ::highlight(${AWAITING_HIGHLIGHT_NAME}) { background: rgba(107, 107, 120, 0.2); text-decoration: underline 2px #6b6b78; text-underline-offset: 2px; }
        ::highlight(${RESOLVED_HIGHLIGHT_NAME}) { background: rgba(167, 243, 208, 0.58); text-decoration: underline 2px rgb(16, 185, 129); text-underline-offset: 2px; }
      `}</style>
      {markers.map((marker) => {
        const tone = commentTone(marker.annotation, marker.detached);
        return (
          <AnnotationMark
            key={marker.annotation.id}
            tone={tone}
            layout="gutter"
            onClick={() => {
              setActionError('');
              setOpenMarker(marker);
            }}
            className="fixed z-[50]"
            style={{ top: marker.top, left: marker.left }}
            title={
              tone === 'resolved'
                ? 'Teacher confirmed fixed'
                : tone === 'fixed'
                  ? 'Waiting for your teacher'
                  : tone === 'reopen'
                    ? 'Check this again'
                    : 'Teacher comment'
            }
            aria-label={
              tone === 'resolved'
                ? 'Confirmed fixed'
                : tone === 'fixed'
                  ? 'Waiting for teacher review'
                  : tone === 'reopen'
                    ? 'Check this comment again'
                    : 'Open teacher comment'
            }
          />
        );
      })}
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
            {openTone === 'resolved' ? (
              <p className="mb-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                Teacher confirmed fixed
              </p>
            ) : openTone === 'fixed' ? null : openTone === 'reopen' ? (
              <p className="mb-1.5 text-sm font-semibold text-rose-600 dark:text-rose-300">
                Check this again please
              </p>
            ) : (
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.13em] text-[#5a5fc3] dark:text-indigo-300">
                Teacher comment
              </p>
            )}
            {(openTone === 'open' || openTone === 'reopen') && !openMarker.detached && (
              <p className="line-clamp-3 text-xs italic text-[#52525c] dark:text-slate-400">
                “{openMarker.annotation.quote}”
              </p>
            )}
            <p
              className={`${
                (openTone === 'open' || openTone === 'reopen') && !openMarker.detached ? 'mt-2' : ''
              } whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-[#3c3c45] dark:text-slate-100`}
            >
              {typeof openMarker.annotation.note === 'string' ? openMarker.annotation.note : ''}
            </p>
            {showChangedPassage && (
              <div className="mt-2.5 space-y-1.5 rounded-xl border border-[#d0d0d8] bg-[#f0f0f3] p-2.5 text-xs dark:border-slate-600 dark:bg-slate-800">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#8a8a96]">Was</p>
                  <p className="mt-0.5 font-medium leading-snug text-[#52525c] line-through decoration-[#c4c4ce] dark:text-slate-400">
                    {openMarkerChange?.before || openMarker.annotation.quote || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#8a8a96]">Now</p>
                  <p className="mt-0.5 font-semibold leading-snug text-[#3c3c45] dark:text-slate-100">
                    {openMarkerChange?.after?.trim()
                      ? openMarkerChange.after.trim()
                      : 'Passage removed or could not be located'}
                  </p>
                </div>
              </div>
            )}
            {actionError && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{actionError}</p>}
          </div>
          <div className="shrink-0 border-t border-[#e4e4ea] bg-[#fafafc] p-3 dark:border-slate-700 dark:bg-slate-950/40">
            {openTone === 'resolved' ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                Confirmed fixed
              </p>
            ) : openTone === 'fixed' ? (
              <p className="rounded-xl border border-[#d0d0d8] bg-[#f0f0f3] px-3 py-2 text-xs font-semibold text-[#5c5c68] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Waiting for your teacher
              </p>
            ) : needsManualCheck ? (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => markCommentFixedManual(openMarker)}
                className="w-full rounded-xl bg-[#6b6b78] px-3 py-2.5 text-sm font-bold text-white hover:bg-[#5a5a66] disabled:opacity-50"
              >
                {actionBusy ? 'Saving…' : 'I’ve checked this'}
              </button>
            ) : (
              <p className="rounded-xl border border-[#d0d0d8] bg-[#f0f0f3] px-3 py-2 text-xs font-semibold text-[#5c5c68] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Waiting for your teacher
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
