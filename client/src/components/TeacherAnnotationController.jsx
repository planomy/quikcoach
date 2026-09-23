import { RemoveButton, CloseButton } from './PanelActions.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  annotationMarkersMatch,
  commentTone,
  documentAnnotationChange,
  COMMENT_HOVER_WASH,
  commentGutterLane,
  locateAnnotationRange,
  plainTextFromElement,
  rangeContainsPoint,
  rangeForPlainOffsets,
  selectionOffsetsWithin,
  clearNamedHighlights,
  hoverRangeBoxes,
  setCommentHoverHighlight,
  setNamedHighlight,
  stackGutterMarkers,
  writingRootForPane,
} from '../lib/annotations.js';
import { clampFixedBox, placementNearAnchor } from '../lib/clampPopup.js';
import { clientLayoutScale, rectRelativeToScrollElement, subscribeViewportChanges, viewportBox } from '../lib/viewport.js';
import { promptDialog } from './ConfirmDialogHost.jsx';
import HintWrap from './HintWrap.jsx';
import AnnotationMark from './AnnotationMark.jsx';

const HIGHLIGHT_NAME = 'iboard-teacher-inline-comments';
const REOPEN_HIGHLIGHT_NAME = 'iboard-teacher-reopen-comments';
const AWAITING_HIGHLIGHT_NAME = 'iboard-teacher-awaiting-comments';
const FIXED_HIGHLIGHT_NAME = 'iboard-teacher-fixed-comments';
const HOVER_HIGHLIGHT_NAME = 'iboard-teacher-hover-comment';
const PENDING_HIGHLIGHT_NAME = 'iboard-teacher-pending-comment';
const EXTRA_PILLS_KEY = 'iboard-teacher-extra-comment-pills';
const MAX_PILLS = 20;
const PENDING_WIDTH = 320;

/** Max scrollable panel height — not the height used for initial placement. */
const PENDING_MAX_HEIGHT = 520;
/** Side card: header + 6 word-pill rows + field. Grow when extras are added. */
const PENDING_PLACE_HEIGHT = 420;
const OPEN_WIDTH = 320;
/** Placement budget for the open-comment card; CSS max-height lets it grow with the note. */
const OPEN_PLACE_HEIGHT = 280;
const OPEN_MAX_HEIGHT = 480;
const MARKER_SIZE = 18;
const INLINE_MARKER_SIZE = 13;
const MARKER_MARGIN = 4;
const GUTTER_INSET = 8;
const LANE_GAP = 10;
const COMPACT_GUTTER_INSET = 5;
const COMPACT_LANE_GAP = 3;

const SHIPPED_PILLS = [
  { id: 'spelling', label: 'Spelling', text: 'Spelling' },
  { id: 'punctuation', label: 'Punctuation', text: 'Punctuation' },
  { id: 'tense', label: 'Tense', text: 'Tense' },
  { id: 'not-clear', label: 'Not clear', text: 'Not clear' },
  { id: 'repetition', label: 'Repetition', text: 'Repetition' },
  { id: 'split', label: 'Split this here', text: 'Split this here' },
  { id: 'fragment', label: 'Fragment', text: 'Fragment' },
  { id: 'too-wordy', label: 'Too wordy', text: 'Too wordy' },
  { id: 'choose-better', label: 'Choose better', text: 'Choose better' },
  { id: 'irrelevant', label: 'Irrelevant', text: 'Irrelevant' },
  { id: 'add-depth', label: 'Add depth / details', text: 'Add depth / details' },
  { id: 'this-is-good', label: 'This is good', text: 'This is good' },
];

function normalizeExtraPills(raw) {
  if (!Array.isArray(raw)) return [];
  const shipped = new Set(SHIPPED_PILLS.map((item) => item.text.toLocaleLowerCase()));
  const seen = new Set();
  const extras = [];
  for (const item of raw) {
    const text = String(item || '').trim().slice(0, 80);
    const key = text.toLocaleLowerCase();
    if (!text || shipped.has(key) || seen.has(key)) continue;
    seen.add(key);
    extras.push(text);
    if (SHIPPED_PILLS.length + extras.length >= MAX_PILLS) break;
  }
  return extras;
}

function loadExtraPills() {
  if (typeof window === 'undefined') return [];
  try {
    return normalizeExtraPills(JSON.parse(localStorage.getItem(EXTRA_PILLS_KEY) || '[]'));
  } catch {
    return [];
  }
}

function saveExtraPills(list) {
  try {
    localStorage.setItem(EXTRA_PILLS_KEY, JSON.stringify(normalizeExtraPills(list)));
  } catch {
    /* ignore storage failures */
  }
}

function currentSocket() {
  if (typeof window === 'undefined') return null;
  return window.__iboardTeacherSocket || null;
}

function findCardFromNode(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  if (!el?.closest) return null;
  const article = el.closest('article');
  if (!article) return null;
  const heading = article.querySelector('h2[title^="ID #"]');
  const match = String(heading?.getAttribute('title') || '').match(/ID #(\d+)/);
  const studentId = Number(article.dataset.studentId || match?.[1]);
  if (!studentId) return null;
  const textPane =
    el.closest('[data-student-writing-pane]') ||
    article.querySelector('[data-student-writing-pane]') ||
    el.closest('div.max-h-52') ||
    article.querySelector('div.max-h-52');
  if (!textPane || !textPane.contains(el)) return null;
  return { article, textPane, studentId };
}

function cardForStudent(studentId) {
  const id = Number(studentId);
  if (!id) return null;

  const modalArticle =
    document.querySelector(`[data-full-draft="true"][data-student-id="${id}"]`) ||
    document.querySelector(`article[role="dialog"][data-student-id="${id}"]`) ||
    document.querySelector(`[role="dialog"][aria-modal="true"][data-student-id="${id}"]`);
  if (modalArticle) {
    const modalPane =
      modalArticle.querySelector('[data-full-draft-pane]') ||
      modalArticle.querySelector('[data-student-writing-pane]');
    if (modalPane) return { article: modalArticle, textPane: modalPane, studentId: id };
  }

  const article =
    document.querySelector(`main article[data-student-id="${id}"]`) ||
    document.querySelector(`article[data-student-id="${id}"]`) ||
    document.querySelector(`h2[title="ID #${id}"]`)?.closest('article');
  const textPane =
    article?.querySelector('[data-student-writing-pane]') || article?.querySelector('div.max-h-52');
  return article && textPane ? { article, textPane, studentId: id } : null;
}

function contentRootForPane(textPane) {
  return writingRootForPane(textPane);
}

function primaryRangeClientRect(range) {
  if (!range) return null;
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length) return rects[rects.length - 1];
  const fallback = range.getBoundingClientRect();
  return fallback.width || fallback.height ? fallback : null;
}

function markerSizeFor(marker) {
  return marker?.layout === 'compact' ? INLINE_MARKER_SIZE : MARKER_SIZE;
}

function markerViewportBox(marker) {
  if (!marker) return null;
  const size = markerSizeFor(marker);
  const width = marker.width || size;
  if (marker.position === 'fixed') {
    return {
      top: marker.top,
      left: marker.left + width - size,
      right: marker.left + width,
      bottom: marker.top + size,
      width: size,
      height: size,
    };
  }
  const card = cardForStudent(marker.studentId);
  const pane = card?.textPane;
  if (!pane) return null;
  const paneRect = pane.getBoundingClientRect();
  const scale = clientLayoutScale(pane);
  const top = paneRect.top + (marker.top - (pane.scrollTop || 0)) * scale;
  const left = paneRect.left + (marker.left - (pane.scrollLeft || 0)) * scale;
  const pipLeft = left + (width - size) * scale;
  return {
    top,
    left: pipLeft,
    right: pipLeft + size * scale,
    bottom: top + size * scale,
    width: size * scale,
    height: size * scale,
  };
}
function isRangeVisibleInPane(rangeRect, paneRect) {
  const margin = 2;
  return (
    rangeRect.bottom > paneRect.top + margin &&
    rangeRect.top < paneRect.bottom - margin &&
    rangeRect.right > paneRect.left + margin &&
    rangeRect.left < paneRect.right - margin
  );
}

function cardUsesCompactPip(card) {
  return !card?.article?.matches?.('[role="dialog"]');
}

function gutterLaneInset(compact, lane, size) {
  const inset = compact ? COMPACT_GUTTER_INSET : GUTTER_INSET;
  if (lane !== 'attention') return inset;
  return inset + size + (compact ? COMPACT_LANE_GAP : LANE_GAP);
}

function markerPosition(range, card, lane = 'done') {
  if (typeof window === 'undefined' || !card?.textPane) return null;

  const rangeRect = primaryRangeClientRect(range);
  if (!rangeRect) return null;

  const pane = card.textPane;
  const paneRect = pane.getBoundingClientRect();
  if (!paneRect.width || !paneRect.height) return null;
  if (!isRangeVisibleInPane(rangeRect, paneRect)) return null;

  // Position relative to the writing pane (portal target), not the text root —
  // markers inside the selectable text tree make RTL drags jump.
  const paneWidth = pane.scrollWidth || pane.clientWidth || pane.offsetWidth;
  const paneHeight = pane.scrollHeight || pane.clientHeight || pane.offsetHeight;
  const compact = cardUsesCompactPip(card);
  const size = compact ? INLINE_MARKER_SIZE : MARKER_SIZE;
  const minLeft = MARKER_MARGIN;
  const minTop = MARKER_MARGIN;
  const maxLeft = paneWidth - size - MARKER_MARGIN;
  const maxTop = paneHeight - size - MARKER_MARGIN;
  if (maxLeft < minLeft || maxTop < minTop) return null;

  // One hairline from the start of the quote on this line out to the margin bubble.
  const local = rectRelativeToScrollElement(pane, rangeRect);
  const laneInset = gutterLaneInset(compact, lane, size);
  const gutterLeft = (pane.scrollLeft || 0) + (pane.clientWidth || paneRect.width) - size - laneInset;
  const left = Math.max(minLeft, Math.min(gutterLeft, local.left));
  const width = Math.max(size, gutterLeft + size - left);
  const underlineY = local.top + local.height - 3;
  const top = Math.max(minTop, Math.min(maxTop, underlineY - size / 2));
  return {
    top,
    left,
    width,
    layout: compact ? 'compact' : 'gutter',
    position: 'absolute',
    root: pane,
  };
}

function detachedMarkerPosition(pane, index, compact = false, lane = 'done') {
  if (!pane) return null;
  const paneRect = pane.getBoundingClientRect();
  if (!paneRect.width || !paneRect.height) return null;
  const size = compact ? INLINE_MARKER_SIZE : MARKER_SIZE;
  const laneInset = gutterLaneInset(compact, lane, size);
  // Keep orphaned ticks in the visible corner of the writing pane.
  const top = (pane.scrollTop || 0) + MARKER_MARGIN + index * (size + 4);
  const left = (pane.scrollLeft || 0) + (pane.clientWidth || paneRect.width) - size - laneInset;
  const maxTop = (pane.scrollTop || 0) + (pane.clientHeight || paneRect.height) - size - MARKER_MARGIN;
  if (top > maxTop) return null;
  return { top, left, width: size, layout: 'orphan', position: 'absolute', root: pane };
}

function teacherMarkerKey(marker) {
  if (!marker?.annotation?.id) return '';
  return `${marker.studentId}:${marker.annotation.id}`;
}

function patchAnnotationInMap(byStudent, annotationId, patch) {
  const id = Number(annotationId);
  if (!id) return byStudent;
  let changed = false;
  const next = { ...byStudent };
  for (const [key, list] of Object.entries(byStudent)) {
    if (!Array.isArray(list) || !list.some((item) => Number(item.id) === id)) continue;
    next[key] = list.map((item) => (Number(item.id) === id ? { ...item, ...patch } : item));
    changed = true;
    break;
  }
  return changed ? next : byStudent;
}

function paneIsOnScreen(paneRect) {
  const vp = viewportBox();
  return (
    paneRect.bottom > vp.top &&
    paneRect.top < vp.top + vp.height &&
    paneRect.right > vp.left &&
    paneRect.left < vp.left + vp.width
  );
}

function annotationMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (id && Array.isArray(value)) out[id] = value;
  }
  return out;
}

function pendingRangeKey(pending) {
  if (!pending) return '';
  return `${pending.studentId}:${pending.start}:${pending.end}`;
}

export default function TeacherAnnotationController() {
  const [socket, setSocket] = useState(currentSocket);
  const [byStudent, setByStudent] = useState({});
  const [pending, setPending] = useState(null);
  const [draftNote, setDraftNote] = useState('');
  const [quickStack, setQuickStack] = useState([]);
  const [extraPills, setExtraPills] = useState(loadExtraPills);
  const [customCommentDraft, setCustomCommentDraft] = useState('');
  const [addingCustomComment, setAddingCustomComment] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [saveNoticeBox, setSaveNoticeBox] = useState(null);
  const saveNoticeRef = useRef(null);
  const [openMarker, setOpenMarker] = useState(null);
  const [popupPinned, setPopupPinned] = useState(false);
  const [markers, setMarkers] = useState([]);
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingWash, setPendingWash] = useState(null);
  const [hoveredKey, setHoveredKey] = useState(null);
  const moveFrameRef = useRef(null);
  const hoverTargetsRef = useRef([]);
  const hoveredKeyRef = useRef(null);
  const popupPinnedRef = useRef(false);
  const markersRef = useRef([]);
  const pendingRef = useRef(null);
  const hoverCloseTimerRef = useRef(null);
  const openPlaceSideRef = useRef(null);
  const openPlaceKeyRef = useRef('');
  const selectingInPaneRef = useRef(false);
  const selectionSettleRef = useRef(null);
  const draftNoteRef = useRef(null);
  const pendingPanelRef = useRef(null);
  const draftNoteLatestRef = useRef('');
  const quickPrefixRef = useRef('');
  markersRef.current = markers;
  pendingRef.current = pending;
  popupPinnedRef.current = popupPinned;

  function dismissCommentPopup() {
    setOpenMarker(null);
    setPopupPinned(false);
    setReviewError('');
    hoveredKeyRef.current = null;
    setHoveredKey(null);
    setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
  }

  function pinCommentPopup(marker) {
    if (!marker) return;
    setOpenMarker(marker);
    setPopupPinned(true);
    setReviewError('');
  }

  function paintPendingSelection() {
    const current = pendingRef.current;
    if (!current) {
      setNamedHighlight(PENDING_HIGHLIGHT_NAME, []);
      setPendingWash((prev) => (prev ? null : prev));
      return;
    }
    const card = cardForStudent(current.studentId);
    if (!card) {
      setNamedHighlight(PENDING_HIGHLIGHT_NAME, []);
      setPendingWash((prev) => (prev ? null : prev));
      return;
    }
    const writingRoot = contentRootForPane(card.textPane) || card.textPane;
    const range = rangeForPlainOffsets(writingRoot, current.start, current.end, current.quote);
    setNamedHighlight(PENDING_HIGHLIGHT_NAME, range ? [range] : [], { force: true });
    const boxes = range ? hoverRangeBoxes(range) : [];
    const next = boxes.length ? { key: pendingRangeKey(current), boxes } : null;
    setPendingWash((prev) => {
      if (!next) return prev ? null : prev;
      if (prev?.key === next.key && prev.boxes.length === next.boxes.length
        && prev.boxes.every((box, index) => (
          Math.abs(box.top - next.boxes[index].top) <= 1
          && Math.abs(box.left - next.boxes[index].left) <= 1
          && Math.abs(box.width - next.boxes[index].width) <= 1
        ))) {
        return prev;
      }
      return next;
    });
  }

  const annotationTotal = useMemo(
    () => Object.values(byStudent).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0),
    [byStudent]
  );

  const fixedCount = useMemo(
    () =>
      Object.values(byStudent).reduce(
        (n, list) =>
          n +
          (Array.isArray(list)
            ? list.filter((item) => item.status === 'fixed' || item.status === 'resolved').length
            : 0),
        0
      ),
    [byStudent]
  );

  const refreshHighlights = useCallback(() => {
    if (typeof document === 'undefined') return;
    // Rebuilding CSS highlights / portaled markers mid-drag mutates the writing
    // DOM and makes Chromium expand right-to-left selections.
    if (selectingInPaneRef.current) return;

    const ranges = [];
    const reopenRanges = [];
    const awaitingRanges = [];
    const resolvedRanges = [];
    const nextMarkers = [];
    const hoverTargets = [];

    for (const [studentKey, annotations] of Object.entries(byStudent)) {
      const studentId = Number(studentKey);
      const card = cardForStudent(studentId);
      if (!card) continue;
      const writingRoot = contentRootForPane(card.textPane) || card.textPane;
      const fullText = plainTextFromElement(writingRoot);
      const paneRect = card.textPane.getBoundingClientRect();
      const detachedCount = { attention: 0, done: 0 };
      const compact = cardUsesCompactPip(card);
      for (const annotation of annotations || []) {
        const { resolved, range } = locateAnnotationRange(writingRoot, annotation, fullText);
        const tone = commentTone(annotation, resolved.detached);
        const lane = commentGutterLane(tone);
        if (!range) {
          if (paneIsOnScreen(paneRect)) {
            const position = detachedMarkerPosition(card.textPane, detachedCount[lane], compact, lane);
            if (position) {
              nextMarkers.push({
                studentId,
                annotation,
                detached: true,
                lane,
                top: position.top,
                left: position.left,
                layout: position.layout || 'gutter',
                width: position.width,
                position: position.position,
              });
              detachedCount[lane] += 1;
            }
          }
          continue;
        }
        if (tone === 'resolved') resolvedRanges.push(range);
        else if (tone === 'fixed') awaitingRanges.push(range);
        else if (tone === 'reopen') reopenRanges.push(range);
        else ranges.push(range);
        hoverTargets.push({ key: `${studentId}:${annotation.id}`, range, tone });
        const position = markerPosition(range, card, lane);
        if (!position) continue;
        nextMarkers.push({
          studentId,
          annotation,
          detached: resolved.detached,
          lane,
          top: position.top,
          left: position.left,
          layout: position.layout || 'gutter',
          width: position.width,
          position: position.position,
        });
      }
    }

    setNamedHighlight(HIGHLIGHT_NAME, ranges);
    setNamedHighlight(REOPEN_HIGHLIGHT_NAME, reopenRanges);
    setNamedHighlight(AWAITING_HIGHLIGHT_NAME, awaitingRanges);
    setNamedHighlight(FIXED_HIGHLIGHT_NAME, resolvedRanges);
    paintPendingSelection();
    hoverTargetsRef.current = hoverTargets;
    const lit = hoverTargets.find((item) => item.key === hoveredKeyRef.current);
    if (lit?.range) setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, lit.range);
    else if (!hoveredKeyRef.current) setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
    const stacked = stackGutterMarkers(nextMarkers, (marker) => (
      (marker.layout === 'compact' ? INLINE_MARKER_SIZE : MARKER_SIZE) + 6
    ));
    setMarkers((prev) => (annotationMarkersMatch(prev, stacked) ? prev : stacked));
    setOpenMarker((previous) => {
      if (!previous) return previous;
      return (
        nextMarkers.find(
          (marker) =>
            Number(marker.studentId) === Number(previous.studentId) &&
            Number(marker.annotation?.id) === Number(previous.annotation?.id)
        ) || null
      );
    });
  }, [byStudent]);

  useEffect(() => {
    const handleSocket = (event) => setSocket(event.detail?.socket || currentSocket());
    window.addEventListener('iboard:teacher-socket', handleSocket);
    if (currentSocket()) setSocket(currentSocket());
    return () => window.removeEventListener('iboard:teacher-socket', handleSocket);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onState = ({ byStudent: next }) => setByStudent(annotationMap(next));
    const onUpdate = ({ studentId, annotations }) => {
      const id = Number(studentId);
      if (!id) return;
      setByStudent((prev) => ({ ...prev, [id]: Array.isArray(annotations) ? annotations : [] }));
    };
    const schedule = () => requestAnimationFrame(() => requestAnimationFrame(refreshHighlights));
    socket.on('teacher-annotations:room', onState);
    socket.on('teacher-annotations:update', onUpdate);
    socket.on('student:live', schedule);
    socket.on('room:state', schedule);
    return () => {
      socket.off('teacher-annotations:room', onState);
      socket.off('teacher-annotations:update', onUpdate);
      socket.off('student:live', schedule);
      socket.off('room:state', schedule);
    };
  }, [socket, refreshHighlights]);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(refreshHighlights));
    return () => cancelAnimationFrame(id);
  }, [refreshHighlights, annotationTotal]);

  useEffect(() => {
    const onMove = () => {
      if (moveFrameRef.current != null) return;
      moveFrameRef.current = requestAnimationFrame(() => {
        moveFrameRef.current = null;
        refreshHighlights();
      });
    };

    const scrollOptions = { capture: true, passive: true };
    const observedScrollers = new Set();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(onMove)
        : null;

    const attachLayoutWatchers = () => {
      for (const pane of document.querySelectorAll('[data-student-writing-pane]')) {
        if (!observedScrollers.has(pane)) {
          observedScrollers.add(pane);
          pane.addEventListener('scroll', onMove, scrollOptions);
          resizeObserver?.observe(pane);
        }
      }
      for (const scroller of document.querySelectorAll('main .overflow-y-auto, main .overflow-auto')) {
        if (!observedScrollers.has(scroller)) {
          observedScrollers.add(scroller);
          scroller.addEventListener('scroll', onMove, scrollOptions);
          resizeObserver?.observe(scroller);
        }
      }
    };

    const layoutObserver = new MutationObserver(() => {
      attachLayoutWatchers();
      onMove();
    });
    layoutObserver.observe(document.body, { childList: true, subtree: true });
    attachLayoutWatchers();

    const unsubscribe = subscribeViewportChanges(onMove);
    window.addEventListener('iboard:teacher-layout', onMove);
    onMove();
    return () => {
      layoutObserver.disconnect();
      resizeObserver?.disconnect();
      for (const scroller of observedScrollers) {
        scroller.removeEventListener('scroll', onMove, scrollOptions);
      }
      observedScrollers.clear();
      unsubscribe();
      window.removeEventListener('iboard:teacher-layout', onMove);
      if (moveFrameRef.current != null) cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
      clearNamedHighlights([
        HIGHLIGHT_NAME,
        REOPEN_HIGHLIGHT_NAME,
        AWAITING_HIGHLIGHT_NAME,
        FIXED_HIGHLIGHT_NAME,
        HOVER_HIGHLIGHT_NAME,
        PENDING_HIGHLIGHT_NAME,
      ]);
    };
  }, [refreshHighlights]);

  useEffect(() => {
    hoveredKeyRef.current = hoveredKey;
  }, [hoveredKey]);

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
      hoveredKeyRef.current = key;
      setHoveredKey((prev) => (prev === key ? prev : key));
      const hit = hoverTargetsRef.current.find((item) => item.key === key);
      if (!key) {
        setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
        return;
      }
      if (!hit?.range) return;
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, hit.range);
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
      if (pendingRef.current || selectingInPaneRef.current || popupPinnedRef.current) return;
      const marker = markersRef.current.find((item) => teacherMarkerKey(item) === key);
      if (!marker) return;
      setOpenMarker((prev) => (teacherMarkerKey(prev) === key ? prev : marker));
    };
    const onMove = (event) => {
      if (selectingInPaneRef.current) return;
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
        applyHover(hoveredKeyRef.current);
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

  const hoveredTarget = hoverTargetsRef.current.find((item) => item.key === hoveredKey) || null;

  useEffect(() => {
    function clearPendingComposer() {
      setPending(null);
      setPendingWash(null);
      setNamedHighlight(PENDING_HIGHLIGHT_NAME, []);
      dismissCommentPopup();
      setQuickStack([]);
      draftNoteLatestRef.current = '';
      quickPrefixRef.current = '';
      setAddingCustomComment(false);
      setCustomCommentDraft('');
    }

    function capturePendingFromSelection({ allowCollapsedClear = true } = {}) {
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        if (allowCollapsedClear) clearPendingComposer();
        return;
      }
      const range = selection.getRangeAt(0);
      const card = findCardFromNode(range.startContainer);
      if (!card || !card.textPane.contains(range.endContainer)) return;
      const writingRoot = contentRootForPane(card.textPane) || card.textPane;
      if (!writingRoot.contains(range.startContainer) || !writingRoot.contains(range.endContainer)) return;
      const fullText = plainTextFromElement(writingRoot);
      const offsets = selectionOffsetsWithin(writingRoot, fullText);
      if (!offsets || offsets.quote.length > 1200) return;
      const existing = pendingRef.current;
      if (
        existing
        && Number(existing.studentId) === Number(card.studentId)
        && existing.start === offsets.start
        && existing.end === offsets.end
      ) {
        return;
      }
      // Double-click / iPad word-expand: keep the side we already chose.
      if (existing && Number(existing.studentId) === Number(card.studentId) && !allowCollapsedClear) {
        setPending((prev) => (prev ? { ...prev, ...offsets } : prev));
        return;
      }
      const highlightRange = rangeForPlainOffsets(writingRoot, offsets.start, offsets.end, offsets.quote) || range;
      const rect = highlightRange.getBoundingClientRect();
      setDraftNote('');
      setQuickStack([]);
      draftNoteLatestRef.current = '';
      quickPrefixRef.current = '';
      setCustomCommentDraft('');
      setAddingCustomComment(false);
      setCommentError('');
      setSaveNotice('');
      const vp = viewportBox();
      const panelWidth = Math.min(PENDING_WIDTH, vp.width - 20);
      const maxHeight = Math.min(PENDING_MAX_HEIGHT, vp.height - 16);
      const placeHeight = Math.min(PENDING_PLACE_HEIGHT, maxHeight);
      const placed = placementNearAnchor({
        anchor: rect,
        width: panelWidth,
        height: placeHeight,
        prefer: 'side',
        padding: 8,
      });
      setPending({
        studentId: card.studentId,
        ...offsets,
        top: placed.top,
        left: placed.left,
        width: panelWidth,
        maxHeight,
        placeSide: placed.side,
        anchor: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        },
      });
      dismissCommentPopup();
    }

    function onMouseDown(event) {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.('[data-teacher-annotation-ui], [data-iboard-dialog]')) return;
      selectingInPaneRef.current = !!target?.closest?.('[data-student-writing-pane]');
      // Review/open marker cards dismiss on outside click (bubble buttons keep data-teacher-annotation-ui).
      dismissCommentPopup();
    }
    let lastPointerUpAt = 0;
    function onPointerUp(event) {
      const now = Date.now();
      if (now - lastPointerUpAt < 40) return;
      lastPointerUpAt = now;
      const wasSelecting = selectingInPaneRef.current;
      selectingInPaneRef.current = false;
      if (wasSelecting) {
        requestAnimationFrame(() => requestAnimationFrame(refreshHighlights));
      }

      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      // Releasing the mouse on the comment popup must not be treated as a new text
      // selection. In particular, closing the popup on Add comment removes the button
      // before its click event can fire, so the annotation never reaches the server.
      // Same for centred prompts (create/rename bank) — they live outside the panel.
      if (target?.closest?.('[data-teacher-annotation-ui], [data-iboard-dialog]')) return;
      capturePendingFromSelection({ allowCollapsedClear: true });
      if (selectionSettleRef.current != null) window.clearTimeout(selectionSettleRef.current);
      // iPad expands a tap-select to the whole word after the first pointerup.
      selectionSettleRef.current = window.setTimeout(() => {
        selectionSettleRef.current = null;
        capturePendingFromSelection({ allowCollapsedClear: false });
      }, 90);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('touchend', onPointerUp, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('touchend', onPointerUp);
      if (selectionSettleRef.current != null) window.clearTimeout(selectionSettleRef.current);
    };
  }, [refreshHighlights]);

  useEffect(() => {
    if (!saveNotice) return undefined;
    const timer = setTimeout(() => setSaveNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [saveNotice]);

  useEffect(() => {
    if (!saveNotice) {
      setSaveNoticeBox(null);
      return undefined;
    }

    const place = () => {
      const tip = saveNoticeRef.current;
      const width = tip?.offsetWidth || Math.min(220, viewportBox().width - 16);
      const height = tip?.offsetHeight || 32;
      const panel = pendingPanelRef.current;
      const panelRect = panel?.getBoundingClientRect();
      if (panelRect && panelRect.width > 0) {
        setSaveNoticeBox(placementNearAnchor({
          anchor: panelRect,
          width,
          height,
          gap: 8,
          padding: 8,
          prefer: 'above',
        }));
        return;
      }
      if (pending) {
        const panelWidth = pending.width || PENDING_WIDTH;
        setSaveNoticeBox(placementNearAnchor({
          anchor: {
            top: pending.top,
            bottom: pending.top + 160,
            left: pending.left,
            right: pending.left + panelWidth,
            width: panelWidth,
            height: 160,
          },
          width,
          height,
          gap: 8,
          padding: 8,
          prefer: 'above',
        }));
        return;
      }
      const header = document.querySelector('.iboard-app-header');
      const headerBottom = header?.getBoundingClientRect().bottom ?? 56;
      const vp = viewportBox();
      setSaveNoticeBox(clampFixedBox({
        top: headerBottom + 12,
        left: vp.left + vp.width / 2 - width / 2,
        width,
        height,
        padding: 8,
      }));
    };

    place();
    const frame = requestAnimationFrame(place);
    const unsubscribe = subscribeViewportChanges(place);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [saveNotice, pending]);

  useEffect(() => {
    if (!pending) return undefined;
    const panel = pendingPanelRef.current;
    if (!panel) return undefined;
    const place = () => {
      const vp = viewportBox();
      const maxHeight = Math.min(PENDING_MAX_HEIGHT, vp.height - 16);
      const width = pending.width || Math.min(PENDING_WIDTH, vp.width - 16);
      const measured = Math.min(panel.offsetHeight || PENDING_PLACE_HEIGHT, maxHeight);
      const anchor = pending.anchor;
      const next = anchor
        ? placementNearAnchor({
            anchor,
            width,
            height: measured,
            prefer: 'side',
            padding: 8,
            lock: pending.placeSide || null,
          })
        : { ...clampFixedBox({
            top: pending.top,
            left: pending.left,
            width,
            height: measured,
            padding: 8,
          }), side: pending.placeSide || 'right' };
      setPending((prev) => {
        if (!prev) return prev;
        if (
          Math.abs(next.top - prev.top) <= 1
          && Math.abs(next.left - prev.left) <= 1
          && prev.placeSide === next.side
          && Math.abs((prev.maxHeight || 0) - maxHeight) <= 1
        ) {
          return prev;
        }
        return { ...prev, top: next.top, left: next.left, width, maxHeight, placeSide: next.side };
      });
    };
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [pending?.studentId, pending?.start, pending?.end, pending?.anchor, extraPills.length, addingCustomComment]);

  useEffect(() => {
    setAddingCustomComment(false);
    setCustomCommentDraft('');
  }, [pending?.studentId, pending?.start, pending?.end]);

  useEffect(() => {
    paintPendingSelection();
  }, [pending?.studentId, pending?.start, pending?.end, pending?.quote]);

  async function copyPendingSelection() {
    const text = String(pending?.quote || '');
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const copyBox = document.createElement('textarea');
        copyBox.value = text;
        copyBox.setAttribute('readonly', '');
        copyBox.style.position = 'fixed';
        copyBox.style.left = '-9999px';
        document.body.appendChild(copyBox);
        copyBox.select();
        copyBox.setSelectionRange(0, copyBox.value.length);
        const copied = document.execCommand('copy');
        copyBox.remove();
        if (!copied) throw new Error('Copy command failed');
      }
      setCommentError('');
      setSaveNotice('Selection copied');
    } catch {
      setCommentError('Could not copy this selection.');
    }
  }

  function reviewFixedComment(marker, action) {
    if (!socket || !marker?.annotation?.id || reviewBusyId) return;
    const annotationId = marker.annotation.id;
    const now = new Date().toISOString();
    const patch =
      action === 'confirm'
        ? { status: 'resolved', resolved_at: now }
        : { status: 'reopen', resolved_at: '' };
    setReviewBusyId(annotationId);
    setReviewError('');
    setByStudent((prev) => patchAnnotationInMap(prev, annotationId, patch));
    dismissCommentPopup();
    socket.emit(
      'teacher:annotation-status',
      { annotationId, action },
      (ack) => {
        setReviewBusyId(null);
        if (ack?.ok) return;
        setReviewError(ack?.error || 'Could not update this comment');
        socket.emit('teacher:annotations-sync', {}, (syncAck) => {
          if (syncAck?.ok) setByStudent(annotationMap(syncAck.byStudent));
        });
      }
    );
  }

  function closePending() {
    setPending(null);
    setPendingWash(null);
    setNamedHighlight(PENDING_HIGHLIGHT_NAME, []);
    setDraftNote('');
    setQuickStack([]);
    draftNoteLatestRef.current = '';
    quickPrefixRef.current = '';
    setCommentError('');
    setAddingCustomComment(false);
    setCustomCommentDraft('');
  }

  function focusDraftEnd(text) {
    requestAnimationFrame(() => {
      const field = draftNoteRef.current;
      if (!field) return;
      field.focus();
      const end = String(text || '').length;
      field.setSelectionRange(end, end);
    });
  }

  function composeQuickDraft(prefix, stack) {
    return [...(prefix ? [prefix] : []), ...stack].join(' · ');
  }

  function writeQuickDraft(prefix, stack) {
    const text = composeQuickDraft(prefix, stack);
    draftNoteLatestRef.current = text;
    setDraftNote(text);
    focusDraftEnd(text);
    return text;
  }

  function applyQuickComment(comment, { forceAdd = false } = {}) {
    setQuickStack((prev) => {
      if (prev.length === 0) {
        quickPrefixRef.current = String(draftNoteLatestRef.current || '').trim();
      }
      const next = forceAdd
        ? (prev.includes(comment) ? prev : [...prev, comment])
        : prev.includes(comment)
          ? prev.filter((item) => item !== comment)
          : [...prev, comment];
      writeQuickDraft(quickPrefixRef.current, next);
      return next;
    });
  }

  function handleQuickCommentClick(event, comment) {
    if (event.shiftKey) {
      applyQuickComment(comment);
      return;
    }
    // Single click: compose that chit (plus any typed prefix) and send immediately.
    const prefix = String(draftNoteLatestRef.current || '').trim();
    const stack = quickStack.includes(comment) ? quickStack : [...quickStack, comment];
    const text = writeQuickDraft(prefix, stack);
    addComment(text);
  }

  function addExtraPill() {
    const comment = customCommentDraft.trim().slice(0, 80);
    if (!comment) return;
    const key = comment.toLocaleLowerCase();
    if (SHIPPED_PILLS.some((item) => item.text.toLocaleLowerCase() === key) || extraPills.some((item) => item.toLocaleLowerCase() === key)) {
      setAddingCustomComment(false);
      setCustomCommentDraft('');
      return;
    }
    if (SHIPPED_PILLS.length + extraPills.length >= MAX_PILLS) {
      setCommentError(`You already have ${MAX_PILLS} pills.`);
      return;
    }
    const next = normalizeExtraPills([...extraPills, comment]);
    setExtraPills(next);
    saveExtraPills(next);
    setCustomCommentDraft('');
    setAddingCustomComment(false);
    setCommentError('');
    requestAnimationFrame(() => draftNoteRef.current?.focus());
  }

  function removeExtraPill(comment) {
    const next = extraPills.filter((item) => item !== comment);
    setExtraPills(next);
    saveExtraPills(next);
    setQuickStack((prev) => {
      if (!prev.includes(comment)) return prev;
      const stack = prev.filter((item) => item !== comment);
      writeQuickDraft(quickPrefixRef.current, stack);
      return stack;
    });
  }

  function addComment(noteOverride) {
    // Only accept an explicit string override (e.g. one-tap chit). Ignore click events
    // from <button onClick={addComment}> so we never stringify them as "[object Object]".
    const raw = typeof noteOverride === 'string' ? noteOverride : draftNote;
    const note = String(raw || '').trim();
    if (!socket || !pending || !note) return;
    setCommentError('');
    socket.emit(
      'teacher:annotation-add',
      {
        studentId: pending.studentId,
        start: pending.start,
        end: pending.end,
        quote: pending.quote,
        prefix: pending.prefix,
        suffix: pending.suffix,
        note,
      },
      (ack) => {
        if (!ack?.ok) {
          setCommentError(ack?.error || 'Could not save this inline comment. Try selecting the passage again.');
          return;
        }
        closePending();
        window.getSelection?.()?.removeAllRanges?.();
      }
    );
  }

  async function editComment(marker) {
    if (!socket) return;
    const next = await promptDialog({
      title: 'Edit teacher comment',
      message: marker.annotation.quote ? `Selected: “${marker.annotation.quote}”` : '',
      defaultValue: marker.annotation.note || '',
      inputLabel: 'Comment',
      confirmLabel: 'Save comment',
      tone: 'brand',
    });
    if (next == null) return;
    const note = String(next).trim();
    if (!note) return;
    socket.emit('teacher:annotation-update', { annotationId: marker.annotation.id, note });
    dismissCommentPopup();
  }

  async function deleteComment(marker) {
    if (!socket) return;
    socket.emit('teacher:annotation-delete', { annotationId: marker.annotation.id });
    dismissCommentPopup();
  }

  const bulkConfirmFixed = useCallback((studentId = 0) => {
    if (!socket || bulkBusy || fixedCount <= 0) return;
    setBulkBusy(true);
    socket.emit(
      'teacher:annotation-bulk-confirm',
      studentId > 0 ? { studentId } : {},
      (ack) => {
        setBulkBusy(false);
        if (!ack?.ok) {
          setSaveNotice(ack?.error || 'Could not clear fixed comments');
          return;
        }
        dismissCommentPopup();
        const cleared = ack.count || fixedCount;
        setSaveNotice(`Cleared ${cleared} fixed comment${cleared === 1 ? '' : 's'}`);
      }
    );
  }, [socket, bulkBusy, fixedCount]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('iboard:fixed-comments', {
        detail: { count: fixedCount, busy: bulkBusy },
      })
    );
  }, [fixedCount, bulkBusy]);

  useEffect(() => {
    const onClear = () => bulkConfirmFixed(0);
    window.addEventListener('iboard:clear-fixed-comments', onClear);
    return () => window.removeEventListener('iboard:clear-fixed-comments', onClear);
  }, [bulkConfirmFixed]);

  const openMarkerAnchor = openMarker ? markerViewportBox(openMarker) : null;
  const openMarkerMaxHeight = Math.max(
    200,
    Math.min(OPEN_MAX_HEIGHT, viewportBox().height - 24)
  );
  const openPlaceKey = openMarker ? teacherMarkerKey(openMarker) : '';
  if (openPlaceKey !== openPlaceKeyRef.current) {
    openPlaceKeyRef.current = openPlaceKey;
    openPlaceSideRef.current = null;
  }
  const openMarkerPos = openMarkerAnchor
    ? (() => {
        const next = placementNearAnchor({
          anchor: openMarkerAnchor,
          width: OPEN_WIDTH,
          height: Math.min(OPEN_PLACE_HEIGHT, openMarkerMaxHeight),
          gap: 10,
          prefer: 'below',
          lock: openPlaceSideRef.current,
        });
        openPlaceSideRef.current = next.side;
        return next;
      })()
    : null;

  const openMarkerChange = useMemo(() => {
    if (!openMarker?.annotation) return null;
    const card = cardForStudent(openMarker.studentId);
    if (!card) return null;
    const writingRoot = contentRootForPane(card.textPane) || card.textPane;
    const fullText = plainTextFromElement(writingRoot);
    return documentAnnotationChange(openMarker.annotation, fullText);
  }, [openMarker]);
  const openMarkerTone = openMarker
    ? commentTone(openMarker.annotation, openMarker.detached)
    : null;

  function renderCommentChrome({ onEdit, onDelete }) {
    return (
      <div className="flex shrink-0 items-center gap-0.5">
        <HintWrap hint="Edit">
          <button
            type="button"
            title=""
            aria-label="Edit comment"
            onClick={onEdit}
            className="grid h-8 w-8 place-items-center rounded-lg text-[#5a5fc3] hover:bg-[#ebeaf8] dark:text-indigo-300 dark:hover:bg-indigo-950/40"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </HintWrap>
        <HintWrap hint="Delete">
          <RemoveButton onClick={onDelete} aria-label="Delete comment" title="" className="!h-8 !w-8" />
        </HintWrap>
      </div>
    );
  }

  function renderShippedPill(pill) {
    const selected = quickStack.includes(pill.text);
    return (
      <HintWrap key={pill.id} hint={pill.label} prefer="above" className="w-full">
        <button
          type="button"
          title=""
          aria-label={`${pill.label}. Click to send. Shift-click to stack.`}
          onClick={(event) => handleQuickCommentClick(event, pill.text)}
          className={`flex min-h-8 w-full items-center justify-center rounded-lg border px-1.5 py-1 text-center text-[10px] font-bold leading-tight transition ${
            selected
              ? 'border-[#5a5fc3] bg-[#5a5fc3] text-white'
              : 'border-[#d5d4e4] bg-white text-[#52525c] hover:border-[#cfcce8] hover:bg-[#ebeaf8] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/40'
          }`}
        >
          {pill.label}
        </button>
      </HintWrap>
    );
  }

  function renderExtraPill(comment) {
    const selected = quickStack.includes(comment);
    return (
      <div key={comment} className="group relative">
        <HintWrap hint={comment} prefer="right" className="w-full">
          <button
            type="button"
            title=""
            aria-label={`${comment}. Click to send. Shift-click to stack.`}
            onClick={(event) => handleQuickCommentClick(event, comment)}
            className={`flex min-h-8 w-full items-center justify-center rounded-lg border px-1.5 py-1 text-center text-[10px] font-bold leading-tight transition ${
              selected
                ? 'border-[#5a5fc3] bg-[#5a5fc3] text-white'
                : 'border-[#d5d4e4] bg-white text-[#52525c] hover:border-[#cfcce8] hover:bg-[#ebeaf8] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            <span className="max-w-full truncate">{comment}</span>
          </button>
        </HintWrap>
        <RemoveButton
          onClick={() => removeExtraPill(comment)}
          aria-label={`Remove pill: ${comment}`}
          title=""
          className="!absolute -right-1 -top-1 !h-4 !w-4 opacity-0 group-hover:opacity-100"
        />
      </div>
    );
  }

  function renderMarkerButton(marker) {
    const live =
      (byStudent[marker.studentId] || []).find((item) => Number(item.id) === Number(marker.annotation.id)) ||
      marker.annotation;
    const tone = commentTone(live, marker.detached);
    const button = (
      <AnnotationMark
        key={`${marker.studentId}-${marker.annotation.id}`}
        tone={tone}
        layout={marker.layout === 'orphan' ? 'orphan' : marker.layout === 'compact' ? 'compact' : 'gutter'}
        lit={hoveredKey === `${marker.studentId}:${marker.annotation.id}`}
        data-ann-key={`${marker.studentId}:${marker.annotation.id}`}
        onClick={() => pinCommentPopup(marker)}
        className={`${marker.position === 'fixed' ? 'fixed' : 'absolute'} z-[10]`}
        style={{ top: marker.top, left: marker.left, width: marker.width || undefined }}
        aria-label={
          tone === 'resolved'
            ? 'Confirmed fixed comment'
            : tone === 'fixed'
              ? 'Review student fix'
              : tone === 'reopen'
                ? 'Check again pending'
                : 'Open inline teacher comment'
        }
      />
    );

    if (marker.position === 'fixed') return button;

    const card = cardForStudent(marker.studentId);
    const pane = card?.textPane;
    if (!pane) return null;
    return createPortal(button, pane);
  }

  return (
    <>
      <style>{`
        ::highlight(${HIGHLIGHT_NAME}) { background: rgba(90, 95, 195, 0.16); }
        ::highlight(${REOPEN_HIGHLIGHT_NAME}) { background: rgba(248, 113, 113, 0.16); }
        ::highlight(${AWAITING_HIGHLIGHT_NAME}) { background: rgba(107, 107, 120, 0.16); }
        ::highlight(${FIXED_HIGHLIGHT_NAME}) { background: rgba(167, 243, 208, 0.5); }
        ::highlight(${HOVER_HIGHLIGHT_NAME}) { background: ${COMMENT_HOVER_WASH[hoveredTarget?.tone] || COMMENT_HOVER_WASH.open}; }
        ::highlight(${PENDING_HIGHLIGHT_NAME}) { background: rgba(90, 95, 195, 0.4); }
      `}</style>
      {(pendingWash?.boxes || []).map((box, index) => (
        <span
          key={`pending-wash-${pendingWash.key}-${index}`}
          className="iboard-ann-hover-wash"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            background: 'rgba(90, 95, 195, 0.4)',
          }}
        />
      ))}

      {markers.map((marker) => renderMarkerButton(marker))}

      {pending && (
        <div
          ref={pendingPanelRef}
          data-teacher-annotation-ui
          className="fixed z-[70] flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border border-[#d5d4e4] bg-white p-2.5 shadow-2xl dark:border-slate-600 dark:bg-slate-900"
          style={{
            top: pending.top,
            left: pending.left,
            width: pending.width || Math.min(PENDING_WIDTH, typeof window !== 'undefined' ? window.innerWidth - 16 : PENDING_WIDTH),
            maxHeight: pending.maxHeight || `min(${PENDING_MAX_HEIGHT}px, calc(100dvh - 16px))`,
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#5a5fc3]">Selected passage</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] italic leading-snug text-[#52525c] dark:text-slate-400">“{pending.quote}”</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={copyPendingSelection}
                className="rounded-md border border-[#d5d4e4] bg-[#ebeaf8] px-2 py-1 text-[10px] font-black text-[#5a5fc3] hover:bg-white dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
              >
                Copy
              </button>
              <HintWrap hint={SHIPPED_PILLS.length + extraPills.length >= MAX_PILLS ? `Pills are full (${MAX_PILLS})` : 'Add a pill'} prefer="below">
                <button
                  type="button"
                  title=""
                  disabled={SHIPPED_PILLS.length + extraPills.length >= MAX_PILLS}
                  aria-label="Add a pill"
                  onClick={() => {
                    setAddingCustomComment((open) => !open);
                    setCustomCommentDraft('');
                  }}
                  className="grid h-7 w-7 place-items-center rounded-md border border-[#d5d4e4] bg-white text-[#5a5fc3] hover:bg-[#ebeaf8] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-200"
                >
                  +
                </button>
              </HintWrap>
            </div>
          </div>

          <div className="mt-2 grid min-h-0 grid-cols-2 gap-1 overflow-y-auto overscroll-contain">
            {SHIPPED_PILLS.map((pill) => renderShippedPill(pill))}
            {extraPills.map((comment) => renderExtraPill(comment))}
          </div>

          {addingCustomComment && (
            <div className="mt-1.5 flex shrink-0 gap-1">
              <input
                autoFocus
                value={customCommentDraft}
                maxLength={80}
                onChange={(event) => setCustomCommentDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addExtraPill();
                  }
                  if (event.key === 'Escape') setAddingCustomComment(false);
                }}
                placeholder="New pill…"
                className="min-w-0 flex-1 rounded-md border border-[#d5d4e4] bg-white px-2 py-1 text-[11px] text-slate-900 outline-none focus:border-[#5a5fc3] dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <button
                type="button"
                disabled={!customCommentDraft.trim()}
                onClick={addExtraPill}
                className="rounded-md bg-[#5a5fc3] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#4f54b0] disabled:opacity-40"
              >
                Add
              </button>
            </div>
          )}

          <textarea
            ref={draftNoteRef}
            autoFocus
            value={draftNote}
            onChange={(event) => {
              const value = event.target.value.slice(0, 500);
              setDraftNote(value);
              draftNoteLatestRef.current = value;
              setQuickStack([]);
              quickPrefixRef.current = value.trim();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                addComment();
              }
              if (event.key === 'Escape') closePending();
            }}
            placeholder="Type your comment…"
            className="mt-2 min-h-[3.25rem] w-full shrink-0 resize-none rounded-lg border border-[#d5d4e4] px-2.5 py-1.5 text-xs text-[#3c3c45] outline-none focus:border-[#5a5fc3] dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />

          {commentError && (
            <p className="mt-1 shrink-0 text-[11px] font-semibold leading-relaxed text-red-600 dark:text-red-300">
              {commentError}
            </p>
          )}
          <div className="mt-1.5 flex shrink-0 items-center justify-end gap-1.5">
            <button type="button" onClick={closePending} className="rounded-md px-2.5 py-1 text-[11px] font-bold text-[#52525c] hover:bg-[#ebeaf8] dark:hover:bg-slate-800">Cancel</button>
            <button type="button" disabled={!draftNote.trim()} onClick={() => addComment()} className="rounded-md bg-[#5a5fc3] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#4f54b0] disabled:opacity-40">Add comment</button>
          </div>
        </div>
      )}

      {openMarker && openMarkerPos && (
        <div
          data-teacher-annotation-ui
          data-comment-popup
          onPointerDown={() => pinCommentPopup(openMarker)}
          className="fixed z-[70] flex flex-col overflow-hidden rounded-2xl border border-[#d5d4e4] bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
          style={{
            top: openMarkerPos.top,
            left: openMarkerPos.left,
            width: OPEN_WIDTH,
            maxHeight: openMarkerMaxHeight,
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-2">
            {openMarkerTone === 'resolved' ? (
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.13em] text-emerald-600 dark:text-emerald-400">
                Confirmed fixed
              </p>
            ) : openMarkerTone === 'fixed' ? (
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.13em] text-[#6b6b78]">
                Waiting for your review
              </p>
            ) : openMarkerTone === 'reopen' ? (
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.13em] text-rose-500">
                Asked to check again
              </p>
            ) : (
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.13em] text-[#5a5fc3] dark:text-indigo-300">
                Your inline comment
              </p>
            )}
            <p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-[#3c3c45] dark:text-slate-100">
              {typeof openMarker.annotation.note === 'string' ? openMarker.annotation.note : ''}
            </p>
            {openMarkerChange ? (
              <div className="mt-2.5 space-y-1.5 rounded-xl border border-[#cfcce8] bg-[#ebeaf8] p-2.5 dark:border-indigo-900 dark:bg-indigo-950/35">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#8a8a96]">Was</p>
                  <p className="mt-0.5 text-xs leading-snug text-[#52525c] line-through decoration-[#c4c4ce] dark:text-slate-400">
                    {openMarkerChange?.before || openMarker.annotation.quote || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#5a5fc3]">Now</p>
                  <p className="mt-0.5 text-xs font-semibold leading-snug text-[#3c3c45] dark:text-slate-100">
                    {openMarkerChange?.removed || !openMarkerChange?.after?.trim()
                      ? 'Removed'
                      : openMarkerChange.after}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-2 line-clamp-3 text-xs italic text-[#52525c] dark:text-slate-400">
                “{openMarker.annotation.quote}”
              </p>
            )}
            {reviewError && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{reviewError}</p>}
          </div>
          <div className="shrink-0 border-t border-[#e4e4ea] bg-[#fafafc] px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950/40">
            {openMarkerTone === 'fixed' || openMarkerTone === 'reopen' ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={reviewBusyId === openMarker.annotation.id}
                  onClick={() => reviewFixedComment(openMarker, 'confirm')}
                  className="min-w-0 flex-1 rounded-lg bg-[#5a5fc3] px-2 py-2 text-[11px] font-bold text-white hover:bg-[#4b50b0] disabled:opacity-50"
                >
                  Confirm fixed
                </button>
                {openMarkerTone === 'fixed' ? (
                  <button
                    type="button"
                    disabled={reviewBusyId === openMarker.annotation.id}
                    onClick={() => reviewFixedComment(openMarker, 'reopen')}
                    className="min-w-0 flex-1 whitespace-nowrap rounded-lg border border-[#d5d4e4] bg-white px-2 py-2 text-[11px] font-bold text-[#3c3c45] hover:bg-[#ebeaf8] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    Check again
                  </button>
                ) : null}
                {renderCommentChrome({
                  onEdit: () => editComment(openMarker),
                  onDelete: () => deleteComment(openMarker),
                })}
              </div>
            ) : openMarker.annotation.status === 'resolved' ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Confirmed fixed</p>
                {renderCommentChrome({
                  onEdit: () => editComment(openMarker),
                  onDelete: () => deleteComment(openMarker),
                })}
              </div>
            ) : (
              renderCommentChrome({
                onEdit: () => editComment(openMarker),
                onDelete: () => deleteComment(openMarker),
              })
            )}
          </div>
        </div>
      )}

      {saveNotice && (
        <div
          data-teacher-annotation-ui
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed z-[80] flex items-center"
          style={{
            top: saveNoticeBox ? saveNoticeBox.top : -9999,
            left: saveNoticeBox ? saveNoticeBox.left : -9999,
            visibility: saveNoticeBox ? 'visible' : 'hidden',
          }}
        >
          <div
            ref={saveNoticeRef}
            className="inline-flex h-8 max-w-[min(22rem,calc(100vw-1.5rem))] items-center truncate rounded-lg border border-[#cfcce8] bg-[#ebeaf8] px-3 text-[11px] font-black text-[#5a5fc3] shadow-sm dark:border-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200"
          >
            {saveNotice}
          </div>
        </div>
      )}
    </>
  );
}
