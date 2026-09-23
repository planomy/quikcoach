import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMENT_HOVER_WASH,
  annotationMarkersMatch,
  commentGutterLane,
  commentTone,
  documentAnnotationChange,
  locateAnnotationRange,
  plainTextFromElement,
  rangeContainsPoint,
  clearNamedHighlights,
  hoverRangeBoxes,
  setCommentHoverHighlight,
  setNamedHighlight,
  stackGutterMarkers,
} from '../lib/annotations.js';
import { placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges, viewportBox } from '../lib/viewport.js';
import AnnotationMark from './AnnotationMark.jsx';

const HIGHLIGHT_NAME = 'iboard-student-inline-comments';
const REOPEN_HIGHLIGHT_NAME = 'iboard-student-reopen-comments';
const AWAITING_HIGHLIGHT_NAME = 'iboard-student-awaiting-comments';
const RESOLVED_HIGHLIGHT_NAME = 'iboard-student-resolved-comments';
const HOVER_HIGHLIGHT_NAME = 'iboard-student-hover-comment';
const MARKER_SIZE = 18;
const MARKER_MARGIN = 6;
const LANE_GAP = 8;
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
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const nextTop = Math.max(padding, Math.min(vh - height - padding, top));
  const nextLeft = Math.max(padding, left);
  const nextWidth = Math.max(height, Math.min(width, vw - padding - nextLeft));
  return { top: nextTop, left: nextLeft, width: nextWidth };
}

function laneShift(lane) {
  return lane === 'attention' ? MARKER_SIZE + LANE_GAP : 0;
}

function markerPosition(rangeRect, editorRect, lane = 'done') {
  const gutterRight = (editorRect?.right || rangeRect.right + 40) - 16 - laneShift(lane);
  const left = rangeRect.left;
  const width = Math.max(MARKER_SIZE, gutterRight - left);
  return clampOnScreen({
    top: rangeRect.top + rangeRect.height - 3 - MARKER_SIZE / 2,
    left,
    width,
    height: MARKER_SIZE,
  });
}

function detachedMarkerPosition(editorRect, index, lane = 'done') {
  return clampOnScreen({
    top: editorRect.top + 8 + index * (MARKER_SIZE + 4),
    left: editorRect.right - MARKER_SIZE - 6 - laneShift(lane),
    width: MARKER_SIZE,
    height: MARKER_SIZE,
  });
}


function studentMarkerKey(marker) {
  return marker?.annotation?.id != null ? String(marker.annotation.id) : '';
}

function commentPopupMaxHeight() {
  const vp = viewportBox();
  return Math.max(220, Math.min(POPUP_HEIGHT, vp.height - 24));
}

function commentPopupPosition(marker, lock = null) {
  const height = commentPopupMaxHeight();
  return placementNearAnchor({
    anchor: {
      top: marker.top,
      left: marker.left + (marker.width || MARKER_SIZE) - MARKER_SIZE,
      right: marker.left + (marker.width || MARKER_SIZE),
      bottom: marker.top + MARKER_SIZE,
      width: MARKER_SIZE,
      height: MARKER_SIZE,
    },
    width: POPUP_WIDTH,
    height,
    gap: 10,
    prefer: 'below',
    lock,
  });
}

export default function StudentAnnotationController({ socket, studentId: suppliedStudentId }) {
  const studentId = Number(suppliedStudentId) || currentStudentId();
  const [annotations, setAnnotations] = useState([]);
  const [markers, setMarkers] = useState([]);
  const [openMarker, setOpenMarker] = useState(null);
  const [popupPinned, setPopupPinned] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [editorTextTick, setEditorTextTick] = useState(0);
  const [hoveredId, setHoveredId] = useState(null);
  const [hoverWash, setHoverWash] = useState(null);
  const moveFrameRef = useRef(null);
  const hoverTargetsRef = useRef([]);
  const hoveredIdRef = useRef(null);
  const popupPinnedRef = useRef(false);
  const markersRef = useRef([]);
  const hoverCloseTimerRef = useRef(null);
  const openPlaceSideRef = useRef(null);
  const openPlaceKeyRef = useRef('');
  const autoFixQueuedRef = useRef(new Set());
  const autoFixTimersRef = useRef(new Map());
  const checkAgainSnapshotRef = useRef(new Map());
  const detachedSinceRef = useRef(new Map());
  const prevToneRef = useRef(new Map());
  markersRef.current = markers;
  popupPinnedRef.current = popupPinned;

  function dismissCommentPopup() {
    setOpenMarker(null);
    setPopupPinned(false);
    setActionError('');
    hoveredIdRef.current = null;
    setHoveredId(null);
    setHoverWash(null);
    setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
  }

  function pinCommentPopup(marker) {
    if (!marker) return;
    setOpenMarker(marker);
    setPopupPinned(true);
    setActionError('');
  }

  const refreshHighlights = useCallback(() => {
    if (typeof document === 'undefined') return;
    const editor = editorElement();
    if (!editor) {
      clearNamedHighlights([
        HIGHLIGHT_NAME,
        REOPEN_HIGHLIGHT_NAME,
        AWAITING_HIGHLIGHT_NAME,
        RESOLVED_HIGHLIGHT_NAME,
        HOVER_HIGHLIGHT_NAME,
      ]);
      hoverTargetsRef.current = [];
      setMarkers([]);
      setHoverWash(null);
      return;
    }
    const text = plainTextFromElement(editor);
    const ranges = [];
    const reopenRanges = [];
    const awaitingRanges = [];
    const resolvedRanges = [];
    const nextMarkers = [];
    const hoverTargets = [];
    const detachedCount = { attention: 0, done: 0 };
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
      const lane = commentGutterLane(tone);
      if (!range) {
        if (editorVisible) {
          const pos = detachedMarkerPosition(editorRect, detachedCount[lane], lane);
          nextMarkers.push({
            annotation,
            detached: true,
            lane,
            top: pos.top,
            left: pos.left,
            width: pos.width,
          });
          detachedCount[lane] += 1;
        }
        continue;
      }
      if (tone === 'resolved') resolvedRanges.push(range);
      else if (tone === 'fixed') awaitingRanges.push(range);
      else if (tone === 'reopen') reopenRanges.push(range);
      else ranges.push(range);
      hoverTargets.push({ key: String(annotation.id), range, tone });
      const rects = Array.from(range.getClientRects()).filter((item) => item.width || item.height);
      const rect = rects[rects.length - 1] || range.getBoundingClientRect();
      if (rect.width || rect.height) {
        const pos = markerPosition(rect, editorRect, lane);
        nextMarkers.push({
          annotation,
          detached: resolved.detached,
          lane,
          top: pos.top,
          left: pos.left,
          width: pos.width,
        });
      }
    }
    setNamedHighlight(HIGHLIGHT_NAME, ranges);
    setNamedHighlight(REOPEN_HIGHLIGHT_NAME, reopenRanges);
    setNamedHighlight(AWAITING_HIGHLIGHT_NAME, awaitingRanges);
    setNamedHighlight(RESOLVED_HIGHLIGHT_NAME, resolvedRanges);
    hoverTargetsRef.current = hoverTargets;
    const lit = hoverTargets.find((item) => item.key === hoveredIdRef.current);
    if (lit?.range) {
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, lit.range);
      setHoverWash({ key: lit.key, tone: lit.tone, boxes: hoverRangeBoxes(lit.range) });
    } else if (!hoveredIdRef.current) {
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
      setHoverWash(null);
    }
    const stacked = stackGutterMarkers(nextMarkers, () => MARKER_SIZE + 6);
    setMarkers((prev) => (annotationMarkersMatch(prev, stacked) ? prev : stacked));
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
    (annotationId, { closePopup = false, showError = false } = {}) => {
      const id = Number(annotationId);
      if (!socket || !id) return;
      setAnnotations((prev) =>
        prev.map((item) =>
          Number(item.id) === id
            ? item.status === 'resolved'
              ? item
              : {
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
        if (showError) setActionError('Could not save this check. Try again.');
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
      if (persisted === 'open' && marker.detached) {
        if (!detachedSinceRef.current.has(id)) detachedSinceRef.current.set(id, Date.now());
      } else {
        detachedSinceRef.current.delete(id);
      }
      const detachedLongEnough =
        marker.detached && Date.now() - (detachedSinceRef.current.get(id) || Date.now()) >= 1500;
      const shouldAuto =
        (persisted === 'open' && detachedLongEnough) ||
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
      clearNamedHighlights([
        HIGHLIGHT_NAME,
        REOPEN_HIGHLIGHT_NAME,
        AWAITING_HIGHLIGHT_NAME,
        RESOLVED_HIGHLIGHT_NAME,
        HOVER_HIGHLIGHT_NAME,
      ]);
    };
  }, [refreshHighlights]);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  useEffect(() => {
    if (openMarker) return;
    setPopupPinned(false);
  }, [openMarker]);

  useEffect(() => {
    const cancelClose = () => {
      if (hoverCloseTimerRef.current != null) {
        clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
    };
    const applyHover = (key) => {
      hoveredIdRef.current = key;
      setHoveredId((prev) => (prev === key ? prev : key));
      const hit = hoverTargetsRef.current.find((item) => item.key === key);
      if (!key) {
        setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
        setHoverWash(null);
        return;
      }
      if (!hit?.range) return;
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, hit.range);
      setHoverWash({ key, tone: hit.tone, boxes: hoverRangeBoxes(hit.range) });
    };
    const scheduleClose = () => {
      if (popupPinnedRef.current) return;
      cancelClose();
      hoverCloseTimerRef.current = setTimeout(() => {
        hoverCloseTimerRef.current = null;
        if (popupPinnedRef.current) return;
        setOpenMarker(null);
        applyHover(null);
      }, 160);
    };
    const openFromMark = (key) => {
      if (popupPinnedRef.current) return;
      const marker = markersRef.current.find((item) => studentMarkerKey(item) === key);
      if (!marker) return;
      setActionError((prev) => (prev ? '' : prev));
      setOpenMarker((prev) => (studentMarkerKey(prev) === key ? prev : marker));
    };
    const onMove = (event) => {
      const { clientX: x, clientY: y } = event;
      const under = document.elementFromPoint(x, y);
      const fromMark = under?.closest?.('.iboard-ann-mark')?.dataset?.annKey;
      const overPopup = !!under?.closest?.('[data-comment-popup]');
      if (fromMark) {
        cancelClose();
        applyHover(fromMark);
        openFromMark(fromMark);
        return;
      }
      if (overPopup) {
        cancelClose();
        applyHover(hoveredIdRef.current);
        return;
      }
      const hit = hoverTargetsRef.current.find((item) => rangeContainsPoint(item.range, x, y));
      if (hit?.key) {
        cancelClose();
        applyHover(hit.key);
        return;
      }
      scheduleClose();
    };
    const onLeave = () => {
      scheduleClose();
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      cancelClose();
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
    };
  }, []);

  const hoveredTarget = hoverTargetsRef.current.find((item) => item.key === hoveredId) || null;

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

  const openPopupPosition = useMemo(() => {
    if (!openMarker) return null;
    const key = studentMarkerKey(openMarker);
    if (openPlaceKeyRef.current !== key) {
      openPlaceKeyRef.current = key;
      openPlaceSideRef.current = null;
    }
    const next = commentPopupPosition(openMarker, openPlaceSideRef.current);
    openPlaceSideRef.current = next.side;
    return next;
  }, [openMarker]);

  const openMarkerChange = useMemo(() => {
    if (!openMarker?.annotation) return null;
    const editor = editorElement();
    if (!editor) return null;
    return documentAnnotationChange(openMarker.annotation, plainTextFromElement(editor));
  }, [openMarker]);

  useEffect(() => {
    if (!openMarker) return undefined;
    function onMouseDown(event) {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.('[data-teacher-annotation-ui]')) return;
      dismissCommentPopup();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openMarker]);

  function markCommentFixedManual(marker) {
    if (!marker?.annotation?.id || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    autoFixQueuedRef.current.add(Number(marker.annotation.id));
    markCommentFixed(marker.annotation.id, { closePopup: true, showError: true });
    dismissCommentPopup();
    setActionBusy(false);
  }

  const openTone = commentTone(openMarker?.annotation, openMarker?.detached);
  const showChangedPassage = !!openMarkerChange;
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
        ::highlight(${HIGHLIGHT_NAME}) { background: rgba(90, 95, 195, 0.16); }
        ::highlight(${REOPEN_HIGHLIGHT_NAME}) { background: rgba(248, 113, 113, 0.16); }
        ::highlight(${AWAITING_HIGHLIGHT_NAME}) { background: rgba(107, 107, 120, 0.16); }
        ::highlight(${RESOLVED_HIGHLIGHT_NAME}) { background: rgba(167, 243, 208, 0.5); }
        ::highlight(${HOVER_HIGHLIGHT_NAME}) { background: ${COMMENT_HOVER_WASH[hoveredTarget?.tone] || COMMENT_HOVER_WASH.open}; }
      `}</style>
      {(hoverWash?.boxes || []).map((box, index) => (
        <span
          key={`wash-${hoverWash.key}-${index}`}
          className="iboard-ann-hover-wash"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            background: COMMENT_HOVER_WASH[hoverWash.tone] || COMMENT_HOVER_WASH.open,
          }}
        />
      ))}
      {markers.map((marker) => {
        const live =
          annotations.find((item) => Number(item.id) === Number(marker.annotation.id)) || marker.annotation;
        const tone = commentTone(live, marker.detached);
        return (
          <AnnotationMark
            key={marker.annotation.id}
            tone={tone}
            layout={marker.detached ? 'orphan' : 'gutter'}
            lit={hoveredId === String(marker.annotation.id)}
            data-ann-key={String(marker.annotation.id)}
            onClick={() => pinCommentPopup(marker)}
            className="fixed z-[50]"
            style={{ top: marker.top, left: marker.left, width: marker.width || undefined }}
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
          data-comment-popup
          onPointerDown={() => pinCommentPopup(openMarker)}
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
                    {openMarkerChange?.removed || !openMarkerChange?.after?.trim()
                      ? 'Removed'
                      : openMarkerChange.after.trim()}
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
