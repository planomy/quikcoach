import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  COMMENT_HOVER_WASH,
  annotationMarkersMatch,
  commentTone,
  locateAnnotationRange,
  plainTextFromElement,
  rangeContainsPoint,
  clearNamedHighlights,
  setCommentHoverHighlight,
  setNamedHighlight,
  stackGutterMarkers,
} from '../lib/annotations.js';
import { subscribeViewportChanges, viewportBox } from '../lib/viewport.js';
import StudentCommentNote from './StudentCommentNote.jsx';

const HIGHLIGHT_NAME = 'iboard-student-inline-comments';
const REOPEN_HIGHLIGHT_NAME = 'iboard-student-reopen-comments';
const AWAITING_HIGHLIGHT_NAME = 'iboard-student-awaiting-comments';
const RESOLVED_HIGHLIGHT_NAME = 'iboard-student-resolved-comments';
const HOVER_HIGHLIGHT_NAME = 'iboard-student-hover-comment';
const NOTE_HEIGHT = 22;
const NOTE_RAIL = 192;
const PIP_INSET = 28;
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

function writingCard() {
  return typeof document === 'undefined' ? null : document.querySelector('.iboard-student-writing-card');
}

function markerPosition(rangeRect, editorRect) {
  const top = rangeRect.bottom - NOTE_HEIGHT;
  const left = rangeRect.left;
  // Stem runs from the highlight out to the note rail (same idea as teacher gutter marks).
  const railRight = editorRect.right - PIP_INSET;
  const width = Math.max(NOTE_HEIGHT + 8, railRight - left);
  return { top, left, width };
}

function detachedMarkerPosition(editorRect, index) {
  return {
    top: editorRect.top + 8 + index * (NOTE_HEIGHT + 4),
    left: editorRect.right - NOTE_RAIL - PIP_INSET,
    width: NOTE_RAIL,
  };
}


export default function StudentAnnotationController({ socket, studentId: suppliedStudentId }) {
  const studentId = Number(suppliedStudentId) || currentStudentId();
  const [annotations, setAnnotations] = useState([]);
  const [markers, setMarkers] = useState([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [editorTextTick, setEditorTextTick] = useState(0);
  const [hoveredId, setHoveredId] = useState(null);
  const moveFrameRef = useRef(null);
  const hoverTargetsRef = useRef([]);
  const hoveredIdRef = useRef(null);
  const hoverCloseTimerRef = useRef(null);
  const annotationsRef = useRef([]);
  const autoFixQueuedRef = useRef(new Set());
  const autoFixTimersRef = useRef(new Map());
  const pendingFixedRef = useRef(new Set());
  const detachedSinceRef = useRef(new Map());
  const prevToneRef = useRef(new Map());

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
      return;
    }
    const text = plainTextFromElement(editor);
    const ranges = [];
    const reopenRanges = [];
    const awaitingRanges = [];
    const resolvedRanges = [];
    const nextMarkers = [];
    const hoverTargets = [];
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
            quoteDetached: true,
            lane: 'note',
            top: pos.top,
            left: pos.left,
            width: pos.width,
          });
          detachedCount += 1;
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
        const pos = markerPosition(rect, editorRect);
        // When a range still paints, keep the stem — same as the teacher board.
        // Only true orphans (no range) hide the stem and sit on the rail.
        nextMarkers.push({
          annotation,
          detached: false,
          quoteDetached: Boolean(resolved.detached),
          lane: 'note',
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
    } else if (!hoveredIdRef.current) {
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
    }
    const stacked = stackGutterMarkers(nextMarkers, () => NOTE_HEIGHT + 4);
    setMarkers((prev) => (annotationMarkersMatch(prev, stacked) ? prev : stacked));
  }, [annotations]);

  const adoptAnnotations = useCallback((list) => {
    const incoming = Array.isArray(list) ? list : [];
    const pending = pendingFixedRef.current;
    if (!pending.size) {
      annotationsRef.current = incoming;
      setAnnotations(incoming);
      return;
    }
    const merged = incoming.map((item) => {
      const id = Number(item?.id);
      if (!id || !pending.has(id)) return item;
      if (item.status === 'fixed' || item.status === 'resolved') {
        pending.delete(id);
        autoFixQueuedRef.current.delete(id);
        return item;
      }
      // Stale sync can still say reopen after we already marked fixed — keep purple.
      return {
        ...item,
        status: 'fixed',
        student_fixed_at: item.student_fixed_at || new Date().toISOString(),
      };
    });
    annotationsRef.current = merged;
    setAnnotations(merged);
  }, []);

  useEffect(() => {
    annotationsRef.current = annotations || [];
    const seen = new Set();
    for (const annotation of annotations || []) {
      const id = Number(annotation.id);
      if (!id) continue;
      seen.add(id);
      const tone = commentTone(annotation);
      const prev = prevToneRef.current.get(id);
      if (tone === 'reopen' && prev !== 'reopen') {
        // Fresh Check again from teacher — allow another auto-fix cycle.
        autoFixQueuedRef.current.delete(id);
        pendingFixedRef.current.delete(id);
      }
      if (tone === 'fixed' || tone === 'resolved') {
        // Only drop the pending lock when the server (or optimistic map) confirms.
        // Keep pending while we are the ones holding fixed against a stale reopen sync.
        if (!pendingFixedRef.current.has(id) || tone === 'resolved') {
          autoFixQueuedRef.current.delete(id);
        }
        if (tone === 'resolved') pendingFixedRef.current.delete(id);
      }
      prevToneRef.current.set(id, tone);
    }
    for (const id of [...prevToneRef.current.keys()]) {
      if (!seen.has(id)) {
        prevToneRef.current.delete(id);
        autoFixQueuedRef.current.delete(id);
        pendingFixedRef.current.delete(id);
      }
    }
    // Keep pips in lockstep when Check again / Confirm lands from the teacher.
    refreshHighlights();
  }, [annotations, refreshHighlights]);

  const markCommentFixed = useCallback(
    (annotationId) => {
      const id = Number(annotationId);
      if (!socket || !id) return;
      pendingFixedRef.current.add(id);
      autoFixQueuedRef.current.add(id);
      setAnnotations((prev) => {
        const next = prev.map((item) =>
          Number(item.id) === id
            ? item.status === 'resolved'
              ? item
              : {
                  ...item,
                  status: 'fixed',
                  student_fixed_at: item.student_fixed_at || new Date().toISOString(),
                }
            : item
        );
        annotationsRef.current = next;
        return next;
      });
      socket.emit('student:annotation-fixed', { annotationId: id }, (ack) => {
        if (ack?.ok) {
          // Server applied it — pending can clear on the next fixed payload.
          return;
        }
        pendingFixedRef.current.delete(id);
        autoFixQueuedRef.current.delete(id);
        socket.emit('student:annotations-sync', {}, (syncAck) => {
          if (syncAck?.ok && Array.isArray(syncAck.annotations)) {
            adoptAnnotations(syncAck.annotations);
          }
        });
      });
    },
    [socket, adoptAnnotations]
  );

  useEffect(() => {
    if (!socket) return;
    const timers = autoFixTimersRef.current;
    const queued = autoFixQueuedRef.current;
    for (const marker of markers) {
      const id = Number(marker.annotation?.id);
      if (!id) continue;
      const live =
        (annotations || []).find((item) => Number(item.id) === id) || marker.annotation;
      const persisted = commentTone(live);
      const watchDetached = persisted === 'open' || persisted === 'reopen';
      if (watchDetached && marker.quoteDetached) {
        if (!detachedSinceRef.current.has(id)) detachedSinceRef.current.set(id, Date.now());
      } else {
        detachedSinceRef.current.delete(id);
      }
      const needMs = persisted === 'reopen' ? AUTO_FIX_DELAY_MS : 1500;
      const detachedLongEnough =
        marker.quoteDetached && Date.now() - (detachedSinceRef.current.get(id) || Date.now()) >= needMs;
      // Only the comment whose quoted passage was revised — never every red pip on the card.
      const shouldAuto = watchDetached && detachedLongEnough;
      if (!shouldAuto) {
        const pending = timers.get(id);
        if (pending) {
          clearTimeout(pending);
          timers.delete(id);
        }
        continue;
      }
      if (queued.has(id) || timers.has(id) || pendingFixedRef.current.has(id)) continue;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          if (queued.has(id) || pendingFixedRef.current.has(id)) return;
          const still =
            (annotationsRef.current || []).find((item) => Number(item.id) === id) ||
            marker.annotation;
          const tone = commentTone(still);
          if ((tone !== 'open' && tone !== 'reopen') || !marker.quoteDetached) return;
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
      adoptAnnotations(list);
    };
    const onUpdate = ({ studentId: incomingId, annotations: list }) => {
      const mine = currentStudentId() || studentId;
      if (mine && Number(incomingId) !== Number(mine)) return;
      adoptAnnotations(list);
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
  }, [socket, studentId, refreshHighlights, adoptAnnotations]);

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
      const host = event.target?.closest?.('[role="textbox"]');
      if (!host || host.getAttribute('contenteditable') === 'false') return;
      schedule();
      setEditorTextTick((n) => n + 1);
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
        return;
      }
      if (!hit?.range) return;
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, hit.range);
    };
    const scheduleClose = () => {
      cancelClose();
      hoverCloseTimerRef.current = setTimeout(() => {
        hoverCloseTimerRef.current = null;
        applyHover(null);
      }, 160);
    };
    const onMove = (event) => {
      const { clientX: x, clientY: y } = event;
      const under = document.elementFromPoint(x, y);
      const fromMark = under?.closest?.('.iboard-student-note')?.dataset?.annKey;
      if (fromMark) {
        cancelClose();
        applyHover(fromMark);
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

  function markCommentFixedManual(marker) {
    if (!marker?.annotation?.id || actionBusy) return;
    setActionBusy(true);
    markCommentFixed(marker.annotation.id);
    setActionBusy(false);
  }

  return (
    <>
      <style>{`
        ::highlight(${HIGHLIGHT_NAME}) { background: rgba(90, 95, 195, 0.16); }
        ::highlight(${REOPEN_HIGHLIGHT_NAME}) { background: rgba(248, 113, 113, 0.16); }
        ::highlight(${AWAITING_HIGHLIGHT_NAME}) { background: rgba(90, 95, 195, 0.16); }
        ::highlight(${RESOLVED_HIGHLIGHT_NAME}) { background: rgba(167, 243, 208, 0.5); }
        ::highlight(${HOVER_HIGHLIGHT_NAME}) { background: ${COMMENT_HOVER_WASH[hoveredTarget?.tone] || COMMENT_HOVER_WASH.open}; }
      `}</style>
      {(() => {
        const board = writingCard();
        const boardRect = board?.getBoundingClientRect();
        const notes = markers.map((marker) => {
          const live =
            annotations.find((item) => Number(item.id) === Number(marker.annotation.id)) || marker.annotation;
          const tone = commentTone(live, marker.detached);
          const style = boardRect
            ? {
                position: 'absolute',
                top: marker.top - boardRect.top,
                left: marker.left - boardRect.left,
                width: marker.width || undefined,
                ...(marker.detached ? { right: PIP_INSET } : {}),
              }
            : {
                position: 'fixed',
                top: marker.top,
                left: marker.left,
                width: marker.width || undefined,
                ...(marker.detached ? { right: PIP_INSET } : {}),
              };
          return (
            <StudentCommentNote
              key={marker.annotation.id}
              tone={tone}
              note={live.note}
              detached={marker.detached}
              lit={hoveredId === String(marker.annotation.id)}
              busy={actionBusy}
              data-ann-key={String(marker.annotation.id)}
              className="z-[50]"
              style={style}
              onCheck={() => markCommentFixedManual(marker)}
            />
          );
        });
        return board ? createPortal(notes, board) : notes;
      })()}
    </>
  );
}
