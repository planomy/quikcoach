import { RemoveButton, CloseButton } from './PanelActions.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  commentTone,
  inferReplacementPassage,
  COMMENT_HOVER_WASH,
  commentGutterLane,
  locateAnnotationRange,
  plainTextFromElement,
  rangeContainsPoint,
  rangeForPlainOffsets,
  selectionOffsetsWithin,
  setCommentHoverHighlight,
  setNamedHighlight,
  stackGutterMarkers,
  writingRootForPane,
} from '../lib/annotations.js';
import { clampFixedBox, placementNearAnchor } from '../lib/clampPopup.js';
import { clientLayoutScale, rectRelativeToScrollElement, subscribeViewportChanges, viewportBox } from '../lib/viewport.js';
import { confirmDialog, promptDialog } from './ConfirmDialogHost.jsx';
import HintWrap from './HintWrap.jsx';
import AnnotationMark from './AnnotationMark.jsx';

const HIGHLIGHT_NAME = 'iboard-teacher-inline-comments';
const REOPEN_HIGHLIGHT_NAME = 'iboard-teacher-reopen-comments';
const AWAITING_HIGHLIGHT_NAME = 'iboard-teacher-awaiting-comments';
const FIXED_HIGHLIGHT_NAME = 'iboard-teacher-fixed-comments';
const HOVER_HIGHLIGHT_NAME = 'iboard-teacher-hover-comment';
const CUSTOM_COMMENTS_KEY = 'iboard-teacher-custom-inline-comments';
const FAVOURITE_COMMENTS_KEY = 'iboard-teacher-favourite-inline-comments';
const COMMENT_BANKS_KEY = 'iboard-teacher-comment-banks-v1';
const DEFAULT_BANK_ID = 'default';
const MAX_FAVOURITES = 8;
const MAX_BANKS = 12;
const MAX_BANK_COMMENTS = 40;
const PENDING_WIDTH = 400;

/** Max scrollable panel height — not the height used for initial placement. */
const PENDING_MAX_HEIGHT = 440;
/** Compact type-first composer; grows when Quick tray opens. */
const PENDING_PLACE_HEIGHT = 200;
const OPEN_WIDTH = 320;
/** Placement budget for the open-comment card; CSS max-height lets it grow with the note. */
const OPEN_PLACE_HEIGHT = 280;
const OPEN_MAX_HEIGHT = 480;
const MARKER_SIZE = 18;
const INLINE_MARKER_SIZE = 14;
const MARKER_MARGIN = 4;
const GUTTER_INSET = 16;
const LANE_GAP = 8;

const CHIT_CATEGORIES = [
  { id: 'fix', label: 'Fix' },
  { id: 'shape', label: 'Shape' },
  { id: 'craft', label: 'Craft' },
  { id: 'praise', label: 'Praise' },
];

/**
 * Default bank: short chip labels, fuller text sent to the student.
 * Keep `text` stable — pins / banks are stored by that string.
 */
const CORE_COMMENT_DEFS = [
  { label: 'Spelling', text: 'Spelling', category: 'fix' },
  { label: 'Punctuation', text: 'Punctuation', category: 'fix' },
  { label: 'Grammar', text: 'Grammar', category: 'fix' },
  { label: 'Fragment', text: 'Fragment sentence', category: 'fix' },
  { label: 'Tense', text: 'Tense slip', category: 'fix' },
  { label: 'Repeated', text: 'Repeated word or idea', category: 'fix' },
  { label: 'Wrong word', text: 'Wrong word choice', category: 'fix' },
  { label: 'New ¶', text: 'New paragraph here', category: 'shape' },
  { label: 'Split sentence', text: 'Split this sentence', category: 'shape' },
  { label: 'Move this', text: 'This belongs somewhere else', category: 'shape' },
  { label: 'Topic sentence?', text: "Where's your topic sentence?", category: 'shape' },
  { label: 'Cut words', text: 'Which words could go?', category: 'craft' },
  { label: 'Precise word', text: "What's a more precise word?", category: 'craft' },
  { label: 'Restart', text: 'How else could this start?', category: 'craft' },
  { label: "Show, don't tell", text: 'Show me this instead of telling me', category: 'craft' },
  { label: 'Argument?', text: 'What are you arguing here?', category: 'craft' },
  { label: 'So what?', text: 'This tells me what happens — what does it mean?', category: 'craft' },
  { label: 'Evidence?', text: "What's your evidence?", category: 'craft' },
  { label: 'Quote meaning', text: 'What does this quote actually suggest?', category: 'craft' },
  { label: 'Link to Q', text: 'How does this link to the question?', category: 'craft' },
  { label: 'Say it again', text: 'Not following you — say it another way', category: 'craft' },
  { label: 'Love this', text: 'Love this', category: 'praise' },
  { label: 'Best line', text: 'This is your best line so far', category: 'praise' },
  { label: 'More like this', text: 'More like this', category: 'praise' },
];

const CORE_COMMENTS = CORE_COMMENT_DEFS.map((item) => item.text);
const CORE_LABEL_BY_TEXT = Object.fromEntries(CORE_COMMENT_DEFS.map((item) => [item.text, item.label]));
/** First-run pins so Default opens as a toolkit, not a wall. */
const DEFAULT_STARTER_PINS = [
  'Spelling',
  'Punctuation',
  'Grammar',
  'New paragraph here',
  'Love this',
  'More like this',
];

function chitLabel(text) {
  return CORE_LABEL_BY_TEXT[text] || text;
}

function starterPins() {
  return DEFAULT_STARTER_PINS.filter((item) => CORE_COMMENTS.includes(item)).slice(0, MAX_FAVOURITES);
}
function normalizeCommentList(raw, limit) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || '').trim().slice(0, 500)).filter(Boolean).slice(0, limit);
}

function newBankId() {
  return `bank-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeBank(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim().slice(0, 40);
  if (!id || id === DEFAULT_BANK_ID || !name) return null;
  const comments = normalizeCommentList(raw.comments, MAX_BANK_COMMENTS);
  const favourites = normalizeCommentList(raw.favourites, MAX_FAVOURITES).filter((item) => comments.includes(item));
  return { id, name, comments, favourites };
}

function loadLegacyCustoms() {
  try {
    return normalizeCommentList(JSON.parse(localStorage.getItem(CUSTOM_COMMENTS_KEY) || '[]'), MAX_BANK_COMMENTS);
  } catch {
    return [];
  }
}

function loadLegacyFavourites(known) {
  try {
    const knownSet = new Set(known);
    return normalizeCommentList(JSON.parse(localStorage.getItem(FAVOURITE_COMMENTS_KEY) || '[]'), MAX_FAVOURITES).filter(
      (item) => knownSet.has(item)
    );
  } catch {
    return [];
  }
}

function loadCommentBankState() {
  const empty = {
    activeId: DEFAULT_BANK_ID,
    defaultFavourites: starterPins(),
    banks: [],
  };
  if (typeof window === 'undefined') return empty;
  try {
    const parsed = JSON.parse(localStorage.getItem(COMMENT_BANKS_KEY) || 'null');
    if (parsed && typeof parsed === 'object') {
      const banks = Array.isArray(parsed.banks)
        ? parsed.banks.map(normalizeBank).filter(Boolean).slice(0, MAX_BANKS)
        : [];
      const activeId =
        parsed.activeId === DEFAULT_BANK_ID || banks.some((bank) => bank.id === parsed.activeId)
          ? parsed.activeId
          : DEFAULT_BANK_ID;
      const savedPins = normalizeCommentList(parsed.defaultFavourites, MAX_FAVOURITES).filter((item) =>
        CORE_COMMENTS.includes(item)
      );
      const legacyPins = loadLegacyFavourites(CORE_COMMENTS);
      return {
        activeId,
        defaultFavourites: savedPins.length ? savedPins : legacyPins.length ? legacyPins : starterPins(),
        banks,
      };
    }
  } catch {
    /* fall through to migrate */
  }
  const legacyCustoms = loadLegacyCustoms();
  const legacyPins = loadLegacyFavourites(CORE_COMMENTS);
  return {
    activeId: DEFAULT_BANK_ID,
    defaultFavourites: legacyPins.length ? legacyPins : starterPins(),
    banks: legacyCustoms.length
      ? [{ id: newBankId(), name: 'My comments', comments: legacyCustoms, favourites: [] }]
      : [],
  };
}

function saveCommentBankState(state) {
  try {
    localStorage.setItem(
      COMMENT_BANKS_KEY,
      JSON.stringify({
        activeId: state.activeId,
        defaultFavourites: state.defaultFavourites.slice(0, MAX_FAVOURITES),
        banks: state.banks.slice(0, MAX_BANKS),
      })
    );
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

  const modalArticle = document.querySelector(
    `[role="dialog"][aria-modal="true"] article[data-student-id="${id}"]`
  );
  if (modalArticle) {
    const modalPane =
      modalArticle.querySelector('[data-student-writing-pane]') ||
      modalArticle.querySelector('div.max-h-52');
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
  return !!card?.article?.classList.contains('iboard-student-card--overview');
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
  const laneInset = compact || lane !== 'attention' ? GUTTER_INSET : GUTTER_INSET + size + LANE_GAP;
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
  const laneInset = compact || lane !== 'attention' ? GUTTER_INSET : GUTTER_INSET + size + LANE_GAP;
  // Keep orphaned ticks in the visible corner of the writing pane.
  const top = (pane.scrollTop || 0) + MARKER_MARGIN + index * (size + 4);
  const left = (pane.scrollLeft || 0) + (pane.clientWidth || paneRect.width) - size - laneInset;
  const maxTop = (pane.scrollTop || 0) + (pane.clientHeight || paneRect.height) - size - MARKER_MARGIN;
  if (top > maxTop) return null;
  return { top, left, width: size, layout: 'orphan', position: 'absolute', root: pane };
}

function markersMatch(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      Number(left.studentId) !== Number(right.studentId) ||
      Number(left.annotation?.id) !== Number(right.annotation?.id) ||
      left.detached !== right.detached ||
      left.position !== right.position ||
      left.layout !== right.layout ||
      left.lane !== right.lane ||
      Math.abs((left.top || 0) - (right.top || 0)) > 0.5 ||
      Math.abs((left.left || 0) - (right.left || 0)) > 0.5 ||
      Math.abs((left.width || 0) - (right.width || 0)) > 0.5
    ) {
      return false;
    }
  }
  return true;
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

export default function TeacherAnnotationController() {
  const [socket, setSocket] = useState(currentSocket);
  const [byStudent, setByStudent] = useState({});
  const [pending, setPending] = useState(null);
  const [draftNote, setDraftNote] = useState('');
  const [quickStack, setQuickStack] = useState([]);
  const [bankState, setBankState] = useState(loadCommentBankState);
  const [customCommentDraft, setCustomCommentDraft] = useState('');
  const [addingCustomComment, setAddingCustomComment] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [saveNoticeBox, setSaveNoticeBox] = useState(null);
  const saveNoticeRef = useRef(null);
  const [openMarker, setOpenMarker] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [chitCategory, setChitCategory] = useState(null);
  const [quickTrayOpen, setQuickTrayOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState(null);
  const moveFrameRef = useRef(null);
  const hoverTargetsRef = useRef([]);
  const hoveredKeyRef = useRef(null);
  const selectingInPaneRef = useRef(false);
  const selectionSettleRef = useRef(null);
  const draftNoteRef = useRef(null);
  const pendingPanelRef = useRef(null);
  const draftNoteLatestRef = useRef('');
  const quickPrefixRef = useRef('');
  const quickHoverOpenRef = useRef(null);
  const quickHoverCloseRef = useRef(null);
  /** Click/tap keeps the tray open; hover alone auto-closes on leave. */
  const quickPinnedOpenRef = useRef(false);

  const activeBankId = bankState.activeId || DEFAULT_BANK_ID;
  const isDefaultBank = activeBankId === DEFAULT_BANK_ID;
  const activeCustomBank = useMemo(
    () => bankState.banks.find((bank) => bank.id === activeBankId) || null,
    [bankState.banks, activeBankId]
  );
  const activeComments = isDefaultBank ? CORE_COMMENTS : activeCustomBank?.comments || [];
  const activeFavourites = isDefaultBank
    ? bankState.defaultFavourites
    : activeCustomBank?.favourites || [];
  const pinnedComments = useMemo(
    () => activeFavourites.filter((item) => activeComments.includes(item)),
    [activeFavourites, activeComments]
  );
  const favouriteSet = useMemo(() => new Set(pinnedComments), [pinnedComments]);
  const browseComments = useMemo(() => {
    if (isDefaultBank) {
      if (!chitCategory) return [];
      return CORE_COMMENT_DEFS
        .filter((item) => item.category === chitCategory && !favouriteSet.has(item.text))
        .map((item) => item.text);
    }
    return activeComments.filter((item) => !favouriteSet.has(item));
  }, [isDefaultBank, chitCategory, favouriteSet, activeComments]);

  function commitBankState(updater) {
    setBankState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveCommentBankState(next);
      return next;
    });
  }

  function selectCommentBank(bankId) {
    commitBankState((prev) => ({ ...prev, activeId: bankId }));
    setAddingCustomComment(false);
    setCustomCommentDraft('');
    setChitCategory(null);
  }

  function clearQuickHoverTimers() {
    if (quickHoverOpenRef.current != null) {
      window.clearTimeout(quickHoverOpenRef.current);
      quickHoverOpenRef.current = null;
    }
    if (quickHoverCloseRef.current != null) {
      window.clearTimeout(quickHoverCloseRef.current);
      quickHoverCloseRef.current = null;
    }
  }

  function resetQuickTray() {
    clearQuickHoverTimers();
    quickPinnedOpenRef.current = false;
    setQuickTrayOpen(false);
    setChitCategory(null);
  }

  function openQuickTraySoon() {
    clearQuickHoverTimers();
    quickHoverOpenRef.current = window.setTimeout(() => {
      quickHoverOpenRef.current = null;
      setQuickTrayOpen(true);
    }, 140);
  }

  function closeQuickTraySoon() {
    if (quickPinnedOpenRef.current) return;
    clearQuickHoverTimers();
    quickHoverCloseRef.current = window.setTimeout(() => {
      quickHoverCloseRef.current = null;
      setQuickTrayOpen(false);
      setChitCategory(null);
    }, 160);
  }

  function toggleQuickTray() {
    clearQuickHoverTimers();
    setQuickTrayOpen((open) => {
      const next = !open;
      quickPinnedOpenRef.current = next;
      if (!next) setChitCategory(null);
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
        const lane = compact ? 'done' : commentGutterLane(tone);
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
    hoverTargetsRef.current = hoverTargets;
    const lit = hoverTargets.find((item) => item.key === hoveredKeyRef.current);
    setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, lit?.range || null);
    const stacked = stackGutterMarkers(nextMarkers, (marker) => (
      (marker.layout === 'compact' ? INLINE_MARKER_SIZE : MARKER_SIZE) + 6
    ));
    setMarkers((prev) => (markersMatch(prev, stacked) ? prev : stacked));
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
      globalThis.CSS?.highlights?.delete?.(HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(REOPEN_HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(AWAITING_HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(FIXED_HIGHLIGHT_NAME);
      globalThis.CSS?.highlights?.delete?.(HOVER_HIGHLIGHT_NAME);
    };
  }, [refreshHighlights]);

  useEffect(() => {
    hoveredKeyRef.current = hoveredKey;
  }, [hoveredKey]);

  useEffect(() => {
    const applyHover = (key) => {
      hoveredKeyRef.current = key;
      const hit = hoverTargetsRef.current.find((item) => item.key === key);
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, hit?.range || null);
      setHoveredKey((prev) => (prev === key ? prev : key));
    };
    const onMove = (event) => {
      if (selectingInPaneRef.current) return;
      const mark = event.target?.closest?.('.iboard-ann-mark');
      const fromMark = mark?.dataset?.annKey;
      if (fromMark) {
        applyHover(fromMark);
        return;
      }
      const hit = hoverTargetsRef.current.find((item) => (
        rangeContainsPoint(item.range, event.clientX, event.clientY)
      ));
      applyHover(hit?.key || null);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      setCommentHoverHighlight(HOVER_HIGHLIGHT_NAME, null);
    };
  }, []);

  const hoveredTarget = hoverTargetsRef.current.find((item) => item.key === hoveredKey) || null;

  useEffect(() => {
    function clearPendingComposer() {
      setPending(null);
      setOpenMarker(null);
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
        prefer: 'below',
        padding: 8,
      });
      setPending({
        studentId: card.studentId,
        ...offsets,
        top: placed.top,
        left: placed.left,
        width: panelWidth,
        maxHeight,
        anchor: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        },
      });
      setOpenMarker(null);
    }

    function onMouseDown(event) {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.('[data-teacher-annotation-ui], [data-iboard-dialog]')) return;
      selectingInPaneRef.current = !!target?.closest?.('[data-student-writing-pane]');
      // Review/open marker cards dismiss on outside click (bubble buttons keep data-teacher-annotation-ui).
      setOpenMarker(null);
      setReviewError('');
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
            prefer: 'below',
            padding: 8,
          })
        : clampFixedBox({
            top: pending.top,
            left: pending.left,
            width,
            height: measured,
            padding: 8,
          });
      setPending((prev) => {
        if (!prev) return prev;
        if (
          Math.abs(next.top - prev.top) <= 1
          && Math.abs(next.left - prev.left) <= 1
          && Math.abs((prev.maxHeight || 0) - maxHeight) <= 1
        ) {
          return prev;
        }
        return { ...prev, top: next.top, left: next.left, width, maxHeight };
      });
    };
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [pending?.studentId, pending?.start, pending?.end, pending?.anchor, pinnedComments.length, browseComments.length, addingCustomComment, activeBankId, chitCategory, quickTrayOpen]);

  useEffect(() => {
    resetQuickTray();
    // Fresh selection always opens type-first — never remember an expanded Quick tray.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on each new pending anchor only
  }, [pending?.studentId, pending?.start, pending?.end]);

  useEffect(() => () => clearQuickHoverTimers(), []);

  useEffect(() => {
    // Persist migrated legacy customs on first mount.
    saveCommentBankState(bankState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot hydrate write
  }, []);

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
    setReviewBusyId(marker.annotation.id);
    setReviewError('');
    socket.emit(
      'teacher:annotation-status',
      { annotationId: marker.annotation.id, action },
      (ack) => {
        setReviewBusyId(null);
        if (!ack?.ok) {
          setReviewError(ack?.error || 'Could not update this comment');
          return;
        }
        setOpenMarker(null);
      }
    );
  }

  function closePending() {
    setPending(null);
    setDraftNote('');
    setQuickStack([]);
    draftNoteLatestRef.current = '';
    quickPrefixRef.current = '';
    setCommentError('');
    resetQuickTray();
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

  function undoQuickComment() {
    setQuickStack((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice(0, -1);
      writeQuickDraft(quickPrefixRef.current, next);
      return next;
    });
  }

  function addCustomComment() {
    if (isDefaultBank || !activeCustomBank) return;
    const comment = customCommentDraft.trim().slice(0, 500);
    if (!comment) return;
    const existing = activeCustomBank.comments.find(
      (item) => item.toLocaleLowerCase() === comment.toLocaleLowerCase()
    );
    // Save to the bank only — do not also stack into the draft comment.
    if (!existing) {
      commitBankState((prev) => ({
        ...prev,
        banks: prev.banks.map((bank) =>
          bank.id === activeCustomBank.id
            ? { ...bank, comments: [...bank.comments, comment].slice(0, MAX_BANK_COMMENTS) }
            : bank
        ),
      }));
    }
    setCustomCommentDraft('');
    setAddingCustomComment(false);
  }

  function removeCustomComment(comment) {
    if (isDefaultBank || !activeCustomBank) return;
    commitBankState((prev) => ({
      ...prev,
      banks: prev.banks.map((bank) =>
        bank.id === activeCustomBank.id
          ? {
              ...bank,
              comments: bank.comments.filter((item) => item !== comment),
              favourites: bank.favourites.filter((item) => item !== comment),
            }
          : bank
      ),
    }));
    setQuickStack((prev) => {
      if (!prev.includes(comment)) return prev;
      const stack = prev.filter((item) => item !== comment);
      writeQuickDraft(quickPrefixRef.current, stack);
      return stack;
    });
  }

  function toggleFavouriteComment(comment) {
    commitBankState((prev) => {
      if (prev.activeId === DEFAULT_BANK_ID) {
        const pinned = prev.defaultFavourites.includes(comment);
        if (pinned) {
          return { ...prev, defaultFavourites: prev.defaultFavourites.filter((item) => item !== comment) };
        }
        if (prev.defaultFavourites.length >= MAX_FAVOURITES) return prev;
        return { ...prev, defaultFavourites: [...prev.defaultFavourites, comment] };
      }
      return {
        ...prev,
        banks: prev.banks.map((bank) => {
          if (bank.id !== prev.activeId) return bank;
          const pinned = bank.favourites.includes(comment);
          if (pinned) {
            return { ...bank, favourites: bank.favourites.filter((item) => item !== comment) };
          }
          if (bank.favourites.length >= MAX_FAVOURITES) return bank;
          return { ...bank, favourites: [...bank.favourites, comment] };
        }),
      };
    });
  }

  async function createCommentBank() {
    if (bankState.banks.length >= MAX_BANKS) {
      setCommentError(`You already have ${MAX_BANKS} comment banks.`);
      return;
    }
    const name = await promptDialog({
      title: 'New comment bank',
      message: 'Name this set for a class or subject — e.g. Junior English, Y10 History, Y12 Ancient.',
      inputLabel: 'Bank name',
      placeholder: 'Y10 History',
      confirmLabel: 'Create bank',
      defaultValue: '',
    });
    const trimmed = String(name || '').trim().slice(0, 40);
    if (!trimmed) return;
    const id = newBankId();
    commitBankState((prev) => ({
      ...prev,
      activeId: id,
      banks: [...prev.banks, { id, name: trimmed, comments: [], favourites: [] }].slice(0, MAX_BANKS),
    }));
    setAddingCustomComment(true);
    setCustomCommentDraft('');
  }

  async function renameActiveBank() {
    if (isDefaultBank || !activeCustomBank) return;
    const name = await promptDialog({
      title: 'Rename comment bank',
      message: 'Teachers often keep one bank per class or subject.',
      inputLabel: 'Bank name',
      placeholder: activeCustomBank.name,
      confirmLabel: 'Save name',
      defaultValue: activeCustomBank.name,
    });
    const trimmed = String(name || '').trim().slice(0, 40);
    if (!trimmed) return;
    commitBankState((prev) => ({
      ...prev,
      banks: prev.banks.map((bank) => (bank.id === activeCustomBank.id ? { ...bank, name: trimmed } : bank)),
    }));
  }

  async function deleteActiveBank() {
    if (isDefaultBank || !activeCustomBank) return;
    const ok = await confirmDialog({
      title: `Delete “${activeCustomBank.name}”?`,
      message: 'The chits in this bank will be removed from this browser. Default comments stay.',
      confirmLabel: 'Delete bank',
      tone: 'danger',
    });
    if (!ok) return;
    commitBankState((prev) => ({
      ...prev,
      activeId: DEFAULT_BANK_ID,
      banks: prev.banks.filter((bank) => bank.id !== activeCustomBank.id),
    }));
    setAddingCustomComment(false);
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
    setOpenMarker(null);
  }

  async function deleteComment(marker) {
    if (!socket) return;
    socket.emit('teacher:annotation-delete', { annotationId: marker.annotation.id });
    setOpenMarker(null);
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
        setOpenMarker(null);
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
  const openMarkerPos = openMarkerAnchor
    ? placementNearAnchor({
        anchor: openMarkerAnchor,
        width: OPEN_WIDTH,
        height: Math.min(OPEN_PLACE_HEIGHT, openMarkerMaxHeight),
        gap: 10,
        prefer: 'below',
      })
    : null;

  const openMarkerChange = useMemo(() => {
    if (!openMarker?.detached || !openMarker.annotation) return null;
    const card = cardForStudent(openMarker.studentId);
    if (!card) return null;
    const writingRoot = contentRootForPane(card.textPane) || card.textPane;
    const fullText = plainTextFromElement(writingRoot);
    return inferReplacementPassage(openMarker.annotation, fullText);
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

  function renderChitChip(comment, { pinned }) {
    const selected = quickStack.includes(comment);
    const pinBlocked = !pinned && activeFavourites.length >= MAX_FAVOURITES;
    const label = chitLabel(comment);
    return (
      <span
        key={comment}
        className={`group inline-flex max-w-full items-stretch overflow-hidden rounded-lg border text-[11px] font-semibold leading-tight transition ${
          selected
            ? 'border-[#5a5fc3] bg-[#5a5fc3] text-white shadow-sm'
            : pinned
              ? 'border-[#cfcce8] bg-[#ebeaf8] text-[#3c3c45] shadow-sm dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-100'
              : 'border-[#d5d4e4] bg-white text-[#52525c] hover:border-[#cfcce8] hover:bg-[#ebeaf8] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/40'
        }`}
      >
        <button
          type="button"
          onClick={(event) => handleQuickCommentClick(event, comment)}
          title={`${comment} · Tap to send · Shift+tap to stack`}
          className="px-2 py-1 text-left hover:brightness-95"
        >
          {label}
        </button>
        <button
          type="button"
          onClick={() => toggleFavouriteComment(comment)}
          disabled={pinBlocked}
          className={`shrink-0 border-l border-current/15 px-1.5 text-[10px] ${
            pinned
              ? 'text-[#5a5fc3] dark:text-indigo-300'
              : 'text-current/35 opacity-0 hover:text-[#5a5fc3] group-hover:opacity-100 focus-visible:opacity-100'
          } disabled:cursor-not-allowed disabled:opacity-0`}
          aria-label={pinned ? `Unpin ${label}` : `Pin ${label} to Quick`}
          title={
            pinned
              ? 'Unpin from Quick'
              : pinBlocked
                ? `Unpin one first (max ${MAX_FAVOURITES})`
                : 'Pin to Quick'
          }
        >
          {pinned ? '★' : '☆'}
        </button>
        {!isDefaultBank && (
          <RemoveButton onClick={() => removeCustomComment(comment)} aria-label={`Remove chit: ${comment}`} title="Remove chit" />
        )}
      </span>
    );
  }

  function renderMarkerButton(marker) {
    const tone = commentTone(marker.annotation, marker.detached);
    const button = (
      <AnnotationMark
        key={`${marker.studentId}-${marker.annotation.id}`}
        tone={tone}
        layout={marker.layout === 'orphan' ? 'orphan' : marker.layout === 'compact' ? 'compact' : 'gutter'}
        lit={hoveredKey === `${marker.studentId}:${marker.annotation.id}`}
        data-ann-key={`${marker.studentId}:${marker.annotation.id}`}
        onClick={() => {
          setReviewError('');
          setOpenMarker(marker);
        }}
        className={`${marker.position === 'fixed' ? 'fixed' : 'absolute'} z-[10]`}
        style={{ top: marker.top, left: marker.left, width: marker.width || undefined }}
        title={
          tone === 'resolved'
            ? 'Confirmed fixed'
            : tone === 'fixed'
              ? `Waiting for review: ${typeof marker.annotation.note === 'string' ? marker.annotation.note : ''}`
              : tone === 'reopen'
                ? 'Asked student to check again'
                : typeof marker.annotation.note === 'string'
                  ? marker.annotation.note
                  : 'Open inline teacher comment'
        }
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
      `}</style>

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
              <div
                onMouseEnter={openQuickTraySoon}
                onMouseLeave={closeQuickTraySoon}
              >
                <button
                  type="button"
                  onClick={toggleQuickTray}
                  aria-expanded={quickTrayOpen}
                  aria-label={quickTrayOpen ? 'Hide quick comments' : 'Show quick comments'}
                  title="Quick comments"
                  className={`grid h-7 w-7 place-items-center rounded-md border text-slate-600 transition dark:text-slate-300 ${
                    quickTrayOpen
                      ? 'border-[#cfcce8] bg-[#ebeaf8] text-[#5a5fc3] dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                  }`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {quickTrayOpen && (
            <div
              className="mt-2 flex min-h-0 flex-1 flex-col border-t border-slate-100 pt-2 dark:border-slate-800"
              onMouseEnter={openQuickTraySoon}
              onMouseLeave={closeQuickTraySoon}
            >
              <div className="flex shrink-0 items-center gap-1">
                <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <button
                    type="button"
                    onClick={() => selectCommentBank(DEFAULT_BANK_ID)}
                    className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wide transition ${
                      isDefaultBank
                        ? 'bg-[#5a5fc3] text-white'
                        : 'border border-[#d5d4e4] bg-white text-[#52525c] hover:bg-[#ebeaf8] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    Default
                  </button>
                  {bankState.banks.map((bank) => {
                    const active = bank.id === activeBankId;
                    return (
                      <button
                        key={bank.id}
                        type="button"
                        onClick={() => selectCommentBank(bank.id)}
                        onDoubleClick={() => {
                          if (active) renameActiveBank();
                        }}
                        title={active ? 'Double-click to rename' : bank.name}
                        className={`max-w-[9rem] shrink-0 truncate rounded-md px-2 py-1 text-[10px] font-black transition ${
                          active
                            ? 'bg-[#5a5fc3] text-white'
                            : 'border border-[#d5d4e4] bg-white text-[#52525c] hover:bg-[#ebeaf8] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {bank.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={createCommentBank}
                    disabled={bankState.banks.length >= MAX_BANKS}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#ebeaf8] text-sm font-black text-[#5a5fc3] hover:bg-[#e0dff5] disabled:opacity-40 dark:bg-indigo-950 dark:text-indigo-200"
                    aria-label="Add a comment bank"
                    title={bankState.banks.length >= MAX_BANKS ? `Max ${MAX_BANKS} banks` : 'Add a named bank'}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={undoQuickComment}
                  disabled={!quickStack.length}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ebeaf8] text-[#52525c] hover:bg-[#e0dff5] disabled:opacity-35 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  aria-label="Undo last quick comment"
                  title="Undo last quick comment"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H13" />
                  </svg>
                </button>
              </div>

              <div className="mt-1.5 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[#5a5fc3]">
                      Quick · ★ pin up to {MAX_FAVOURITES}
                    </p>
                    {!isDefaultBank && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={renameActiveBank}
                          className="rounded px-1.5 py-0.5 text-[9px] font-bold text-[#52525c] hover:bg-[#ebeaf8] dark:hover:bg-slate-800"
                          title="Rename bank"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={deleteActiveBank}
                          className="rounded px-1.5 py-0.5 text-[9px] font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                          title="Delete bank"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAddingCustomComment((open) => !open);
                            setCustomCommentDraft('');
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ebeaf8] text-xs font-black text-[#5a5fc3] hover:bg-[#e0dff5] dark:bg-indigo-950 dark:text-indigo-200"
                          aria-label="Add a chit to this bank"
                          title="Add a chit to this bank"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap content-start gap-1">
                    {!pinnedComments.length && (
                      <p className="px-0.5 py-1 text-[10px] font-semibold text-slate-400">
                        {isDefaultBank
                          ? 'Open Fix / Shape / Craft / Praise and ★ pin what you use.'
                          : 'Empty — tap + to add chits, then ★ pin your favourites.'}
                      </p>
                    )}
                    {pinnedComments.map((comment) => renderChitChip(comment, { pinned: true }))}
                  </div>
                </div>

                {isDefaultBank ? (
                  <div>
                    <div
                      className="inline-flex w-full rounded-xl border border-[#d5d4e4] bg-[#ebeaf8] p-0.5 dark:border-slate-700 dark:bg-slate-950"
                      role="tablist"
                      aria-label="Comment categories"
                    >
                      {CHIT_CATEGORIES.map((category) => {
                        const active = chitCategory === category.id;
                        return (
                          <button
                            key={category.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setChitCategory((current) => (current === category.id ? null : category.id))}
                            className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[10px] font-black transition ${
                              active
                                ? 'bg-[#5a5fc3] text-white shadow-sm'
                                : 'text-[#52525c] hover:bg-white/70 hover:text-[#3c3c45] dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                          >
                            {category.label}
                          </button>
                        );
                      })}
                    </div>
                    {chitCategory ? (
                      <div className="mt-1.5 flex flex-wrap content-start gap-1" role="tabpanel">
                        {browseComments.map((comment) => renderChitChip(comment, { pinned: false }))}
                        {!browseComments.length && (
                          <p className="px-0.5 py-1 text-[10px] font-semibold text-slate-400">
                            All {CHIT_CATEGORIES.find((item) => item.id === chitCategory)?.label || ''} chits are pinned.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    {browseComments.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setChitCategory((current) => (current === 'all' ? null : 'all'))}
                          className="text-[10px] font-black text-[#5a5fc3] hover:underline dark:text-indigo-300"
                        >
                          {chitCategory === 'all' ? 'Hide bank chits' : `Show all bank chits · ${browseComments.length}`}
                        </button>
                        {chitCategory === 'all' && (
                          <div className="mt-1.5 flex flex-wrap content-start gap-1">
                            {browseComments.map((comment) => renderChitChip(comment, { pinned: false }))}
                          </div>
                        )}
                      </>
                    )}
                    {!activeComments.length && (
                      <p className="px-0.5 py-1 text-[10px] font-semibold text-slate-400">
                        Empty bank — tap + to add chits for this class.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {addingCustomComment && !isDefaultBank && (
                <div className="mt-1.5 shrink-0 rounded-lg border border-[#d5d4e4] bg-[#ebeaf8] p-1.5 dark:border-indigo-900 dark:bg-indigo-950/40">
                  <label htmlFor="custom-inline-comment" className="text-[9px] font-bold text-[#5a5fc3] dark:text-indigo-200">
                    New chit in {activeCustomBank?.name || 'this bank'}
                  </label>
                  <div className="mt-1 flex gap-1">
                    <input
                      id="custom-inline-comment"
                      autoFocus
                      value={customCommentDraft}
                      maxLength={500}
                      onChange={(event) => setCustomCommentDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addCustomComment();
                        }
                        if (event.key === 'Escape') setAddingCustomComment(false);
                      }}
                      placeholder="Type your comment…"
                      className="min-w-0 flex-1 rounded-md border border-[#d5d4e4] bg-white px-2 py-1 text-[11px] text-slate-900 outline-none focus:border-[#5a5fc3] dark:border-indigo-800 dark:bg-slate-950 dark:text-white"
                    />
                    <button
                      type="button"
                      disabled={!customCommentDraft.trim()}
                      onClick={addCustomComment}
                      className="rounded-md bg-[#5a5fc3] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#4f54b0] disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
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
            {openMarker.detached ? (
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
                    {openMarkerChange?.after?.trim()
                      ? openMarkerChange.after
                      : 'Passage removed or could not be located'}
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
            {openMarkerTone === 'fixed' ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={reviewBusyId === openMarker.annotation.id}
                  onClick={() => reviewFixedComment(openMarker, 'confirm')}
                  className="min-w-0 flex-1 rounded-lg bg-[#5a5fc3] px-2 py-2 text-[11px] font-bold text-white hover:bg-[#4b50b0] disabled:opacity-50"
                >
                  Confirm fixed
                </button>
                <button
                  type="button"
                  disabled={reviewBusyId === openMarker.annotation.id}
                  onClick={() => reviewFixedComment(openMarker, 'reopen')}
                  className="min-w-0 flex-1 whitespace-nowrap rounded-lg border border-[#d5d4e4] bg-white px-2 py-2 text-[11px] font-bold text-[#3c3c45] hover:bg-[#ebeaf8] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Check again
                </button>
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
