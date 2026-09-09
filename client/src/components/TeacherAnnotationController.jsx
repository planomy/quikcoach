import { RemoveButton, CloseButton } from './PanelActions.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  plainTextFromElement,
  rangeForPlainOffsets,
  resolveAnnotation,
  selectionOffsetsWithin,
  writingRootForPane,
} from '../lib/annotations.js';
import { clampFixedBox, placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges, viewportBox } from '../lib/viewport.js';
import { confirmDialog, promptDialog } from './ConfirmDialogHost.jsx';

const HIGHLIGHT_NAME = 'iboard-teacher-inline-comments';
const FIXED_HIGHLIGHT_NAME = 'iboard-teacher-fixed-comments';
const CUSTOM_COMMENTS_KEY = 'iboard-teacher-custom-inline-comments';
const FAVOURITE_COMMENTS_KEY = 'iboard-teacher-favourite-inline-comments';
const COMMENT_BANKS_KEY = 'iboard-teacher-comment-banks-v1';
const DEFAULT_BANK_ID = 'default';
const MAX_FAVOURITES = 8;
const MAX_BANKS = 12;
const MAX_BANK_COMMENTS = 40;
const PENDING_WIDTH = 468;
/** Max scrollable panel height — not the height used for initial placement. */
const PENDING_MAX_HEIGHT = 520;
/** Typical composer height (header + banks + a few chits + draft). Oversizing this
 *  makes clampFixedBox pin the panel to the top of the viewport. */
const PENDING_PLACE_HEIGHT = 300;
const OPEN_WIDTH = 280;
const OPEN_HEIGHT = 220;
const MARKER_SIZE = 28;
const MARKER_MARGIN = 6;
/** Default bank — curated. Teachers keep subject banks separately (Junior Eng, Y10 History, …). */
const CORE_COMMENTS = [
  'Spelling',
  'Punctuation',
  'Grammar',
  'Fragment sentence',
  'Tense slip',
  'Repeated word or idea',
  'Wrong word choice',
  'New paragraph here',
  'Split this sentence',
  'This belongs somewhere else',
  "Where's your topic sentence?",
  'Which words could go?',
  "What's a more precise word?",
  'How else could this start?',
  'Show me this instead of telling me',
  'What are you arguing here?',
  'This tells me what happens — what does it mean?',
  "What's your evidence?",
  'What does this quote actually suggest?',
  'How does this link to the question?',
  'Not following you — say it another way',
  'Love this',
  'This is your best line so far',
  'More like this',
];

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
    defaultFavourites: loadLegacyFavourites(CORE_COMMENTS),
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
      const defaultFavourites = normalizeCommentList(parsed.defaultFavourites, MAX_FAVOURITES).filter((item) =>
        CORE_COMMENTS.includes(item)
      );
      return {
        activeId,
        defaultFavourites: defaultFavourites.length ? defaultFavourites : loadLegacyFavourites(CORE_COMMENTS),
        banks,
      };
    }
  } catch {
    /* fall through to migrate */
  }
  const legacyCustoms = loadLegacyCustoms();
  return {
    activeId: DEFAULT_BANK_ID,
    defaultFavourites: loadLegacyFavourites(CORE_COMMENTS),
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

function orderBankComments(comments, favourites) {
  const pinned = favourites.filter((item) => comments.includes(item));
  const pinnedSet = new Set(pinned);
  return [...pinned, ...comments.filter((item) => !pinnedSet.has(item))];
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

function markerViewportBox(marker) {
  if (!marker) return null;
  if (marker.position === 'fixed') {
    return {
      top: marker.top,
      left: marker.left,
      right: marker.left + MARKER_SIZE,
      bottom: marker.top + MARKER_SIZE,
      width: MARKER_SIZE,
      height: MARKER_SIZE,
    };
  }
  const card = cardForStudent(marker.studentId);
  const root = card && contentRootForPane(card.textPane);
  if (!root) return null;
  const rootRect = root.getBoundingClientRect();
  const top = rootRect.top + marker.top;
  const left = rootRect.left + marker.left;
  return {
    top,
    left,
    right: left + MARKER_SIZE,
    bottom: top + MARKER_SIZE,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
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

function markerPosition(range, card) {
  if (typeof window === 'undefined' || !card?.textPane) return null;

  const rangeRect = primaryRangeClientRect(range);
  if (!rangeRect) return null;

  const pane = card.textPane;
  const paneRect = pane.getBoundingClientRect();
  if (!paneRect.width || !paneRect.height) return null;
  if (!isRangeVisibleInPane(rangeRect, paneRect)) return null;

  const root = contentRootForPane(pane);
  const rootRect = root.getBoundingClientRect();

  const paneLeftInRoot = paneRect.left - rootRect.left;
  const paneRightInRoot = paneRect.right - rootRect.left;
  const paneTopInRoot = paneRect.top - rootRect.top;
  const paneBottomInRoot = paneRect.bottom - rootRect.top;

  const minLeft = paneLeftInRoot + MARKER_MARGIN;
  const maxLeft = paneRightInRoot - MARKER_SIZE - MARKER_MARGIN;
  const minTop = paneTopInRoot + MARKER_MARGIN;
  const maxTop = paneBottomInRoot - MARKER_SIZE - MARKER_MARGIN;
  if (maxLeft < minLeft || maxTop < minTop) return null;

  // Sit on the top-right corner of the highlight so the bubble clears the next words.
  let left = rangeRect.right - rootRect.left - MARKER_SIZE * 0.45;
  let top = rangeRect.top - rootRect.top - MARKER_SIZE + 10;
  if (top < minTop) top = rangeRect.top - rootRect.top - 4;
  left = Math.max(minLeft, Math.min(maxLeft, left));
  top = Math.max(minTop, Math.min(maxTop, top));

  return { top, left, position: 'absolute', root };
}

function detachedMarkerPosition(pane, index) {
  if (!pane) return null;
  const root = contentRootForPane(pane) || pane;
  const paneRect = pane.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  if (!paneRect.width || !paneRect.height) return null;
  // Keep orphaned ticks inside the writing pane — never fixed to the viewport chrome.
  const top = paneRect.top - rootRect.top + MARKER_MARGIN + index * (MARKER_SIZE + 4);
  const left = paneRect.right - rootRect.left - MARKER_SIZE - MARKER_MARGIN;
  const maxTop = paneRect.bottom - rootRect.top - MARKER_SIZE - MARKER_MARGIN;
  if (top > maxTop) return null;
  return { top, left, position: 'absolute', root };
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
  const [openMarker, setOpenMarker] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const moveFrameRef = useRef(null);
  const draftNoteRef = useRef(null);
  const pendingPanelRef = useRef(null);
  const draftNoteLatestRef = useRef('');
  const quickPrefixRef = useRef('');

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
  const orderedQuickComments = useMemo(
    () => orderBankComments(activeComments, activeFavourites),
    [activeComments, activeFavourites]
  );
  const favouriteSet = useMemo(() => new Set(activeFavourites), [activeFavourites]);

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
  }

  const annotationTotal = useMemo(
    () => Object.values(byStudent).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0),
    [byStudent]
  );

  const fixedCount = useMemo(
    () =>
      Object.values(byStudent).reduce(
        (n, list) => n + (Array.isArray(list) ? list.filter((item) => item.status === 'fixed').length : 0),
        0
      ),
    [byStudent]
  );

  const refreshHighlights = useCallback(() => {
    if (typeof document === 'undefined') return;
    const ranges = [];
    const fixedRanges = [];
    const nextMarkers = [];

    for (const [studentKey, annotations] of Object.entries(byStudent)) {
      const studentId = Number(studentKey);
      const card = cardForStudent(studentId);
      if (!card) continue;
      const writingRoot = contentRootForPane(card.textPane) || card.textPane;
      const fullText = plainTextFromElement(writingRoot);
      const paneRect = card.textPane.getBoundingClientRect();
      let detachedCount = 0;
      for (const annotation of annotations || []) {
        const fixed = annotation.status === 'fixed';
        const resolved = resolveAnnotation(annotation, fullText);
        const range = resolved.detached ? null : rangeForPlainOffsets(writingRoot, resolved.start, resolved.end);
        if (!range) {
          if (paneIsOnScreen(paneRect)) {
            const position = detachedMarkerPosition(card.textPane, detachedCount);
            if (position) {
              nextMarkers.push({
                studentId,
                annotation,
                detached: true,
                top: position.top,
                left: position.left,
                position: position.position,
              });
              detachedCount += 1;
            }
          }
          continue;
        }
        (fixed ? fixedRanges : ranges).push(range);
        const position = markerPosition(range, card);
        if (!position) continue;
        nextMarkers.push({
          studentId,
          annotation,
          detached: false,
          top: position.top,
          left: position.left,
          position: position.position,
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
      globalThis.CSS?.highlights?.delete?.(FIXED_HIGHLIGHT_NAME);
    };
  }, [refreshHighlights]);

  useEffect(() => {
    function onMouseUp(event) {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      // Releasing the mouse on the comment popup must not be treated as a new text
      // selection. In particular, closing the popup on Add comment removes the button
      // before its click event can fire, so the annotation never reaches the server.
      // Same for centred prompts (create/rename bank) — they live outside the panel.
      if (target?.closest?.('[data-teacher-annotation-ui], [data-iboard-dialog]')) return;
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        setPending(null);
        setQuickStack([]);
        draftNoteLatestRef.current = '';
        quickPrefixRef.current = '';
        setAddingCustomComment(false);
        setCustomCommentDraft('');
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
      const rect = range.getBoundingClientRect();
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
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    if (!saveNotice) return undefined;
    const timer = setTimeout(() => setSaveNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [saveNotice]);

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
  }, [pending?.studentId, pending?.start, pending?.end, pending?.anchor, orderedQuickComments.length, addingCustomComment, activeBankId]);

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
        setSaveNotice(action === 'confirm' ? 'Fix confirmed' : 'Comment reopened for the student');
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
    const note = String(noteOverride ?? draftNote).trim();
    if (!socket || !pending || !note) return;
    const quotedText = pending.quote;
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
        setSaveNotice(`Inline comment saved for “${quotedText}”`);
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
  const openMarkerPos = openMarkerAnchor
    ? placementNearAnchor({
        anchor: openMarkerAnchor,
        width: OPEN_WIDTH,
        height: OPEN_HEIGHT,
        gap: 10,
        prefer: 'below',
      })
    : null;

  function renderMarkerButton(marker) {
    const button = (
      <button
        key={`${marker.studentId}-${marker.annotation.id}`}
        data-teacher-annotation-ui
        type="button"
        onClick={() => {
          setReviewError('');
          setOpenMarker(marker);
        }}
        className={`${marker.position === 'fixed' ? 'fixed' : 'absolute'} z-[10] flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-black text-white shadow-lg transition ${
          marker.annotation.status === 'fixed'
            ? 'bg-emerald-500/75 hover:bg-emerald-600'
            : 'bg-indigo-600 hover:bg-indigo-700'
        }`}
        style={{ top: marker.top, left: marker.left }}
        title={marker.annotation.status === 'fixed' ? `Student marked fixed: ${marker.annotation.note}` : marker.annotation.note}
        aria-label={marker.annotation.status === 'fixed' ? 'Review student fix' : 'Open inline teacher comment'}
      >
        {marker.annotation.status === 'fixed' ? '✓' : '💬'}
      </button>
    );

    if (marker.position === 'fixed') return button;

    const card = cardForStudent(marker.studentId);
    const root = card && contentRootForPane(card.textPane);
    if (!root) return null;
    return createPortal(button, root);
  }

  return (
    <>
      <style>{`
        ::highlight(${HIGHLIGHT_NAME}) { background: rgba(196, 181, 253, 0.72); text-decoration: underline 2px rgb(124, 58, 237); text-underline-offset: 2px; }
        ::highlight(${FIXED_HIGHLIGHT_NAME}) { background: rgba(167, 243, 208, 0.58); text-decoration: underline 2px rgb(16, 185, 129); text-underline-offset: 2px; }
      `}</style>

      {markers.map((marker) => renderMarkerButton(marker))}

      {pending && (
        <div
          ref={pendingPanelRef}
          data-teacher-annotation-ui
          className="fixed z-[70] flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white p-2.5 shadow-2xl dark:border-indigo-800 dark:bg-slate-900"
          style={{
            top: pending.top,
            left: pending.left,
            width: pending.width || Math.min(PENDING_WIDTH, typeof window !== 'undefined' ? window.innerWidth - 16 : PENDING_WIDTH),
            maxHeight: pending.maxHeight || `min(${PENDING_MAX_HEIGHT}px, calc(100dvh - 16px))`,
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.13em] text-indigo-600">Selected passage</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] italic leading-snug text-slate-500 dark:text-slate-400">“{pending.quote}”</p>
            </div>
            <button
              type="button"
              onClick={copyPendingSelection}
              className="shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
            >
              Copy
            </button>
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1">
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => selectCommentBank(DEFAULT_BANK_ID)}
                  className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wide transition ${
                    isDefaultBank
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
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
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
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
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-sm font-black text-indigo-700 hover:bg-indigo-200 disabled:opacity-40 dark:bg-indigo-950 dark:text-indigo-200"
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
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-35 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                aria-label="Undo last quick comment"
                title="Undo last quick comment"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14 4 9l5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H13" />
                </svg>
              </button>
            </div>
            <div className="mt-1 flex shrink-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[9px] font-semibold text-slate-400">
                {isDefaultBank
                  ? `Default · ★ pin · max ${MAX_FAVOURITES}`
                  : `${activeCustomBank?.name || 'Bank'} · ★ pin · add your chits`}
              </p>
              <div className="flex items-center gap-1">
                {!isDefaultBank && (
                  <>
                    <button
                      type="button"
                      onClick={renameActiveBank}
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-black text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-200"
                      aria-label="Add a chit to this bank"
                      title="Add a chit to this bank"
                    >
                      +
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="flex flex-wrap content-start gap-0.5">
                {!orderedQuickComments.length && !isDefaultBank && (
                  <p className="px-0.5 py-1 text-[10px] font-semibold text-slate-400">
                    Empty bank — tap + to add chits for this class.
                  </p>
                )}
                {orderedQuickComments.map((comment) => {
                  const selected = quickStack.includes(comment);
                  const pinned = favouriteSet.has(comment);
                  const pinBlocked = !pinned && activeFavourites.length >= MAX_FAVOURITES;
                  return (
                    <span
                      key={comment}
                      className={`group inline-flex max-w-full items-stretch overflow-hidden rounded border text-[9px] font-semibold leading-tight transition ${
                        selected
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : pinned
                            ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
                            : isDefaultBank
                              ? 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                              : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(event) => handleQuickCommentClick(event, comment)}
                        title="Click to send · Shift+click to stack more"
                        className="px-1.5 py-0.5 text-left hover:brightness-95"
                      >
                        {comment}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFavouriteComment(comment)}
                        disabled={pinBlocked}
                        className={`shrink-0 border-l border-current/15 px-1 ${
                          pinned
                            ? 'text-amber-600 dark:text-amber-300'
                            : 'text-current/40 opacity-0 hover:text-amber-600 group-hover:opacity-100 focus-visible:opacity-100'
                        } disabled:cursor-not-allowed disabled:opacity-0`}
                        aria-label={pinned ? `Unpin ${comment}` : `Pin ${comment} to top`}
                        title={
                          pinned
                            ? 'Unpin from top'
                            : pinBlocked
                              ? `Unpin one first (max ${MAX_FAVOURITES})`
                              : 'Pin to top'
                        }
                      >
                        {pinned ? '★' : '☆'}
                      </button>
                      {!isDefaultBank && (
                        <RemoveButton onClick={() => removeCustomComment(comment)} aria-label={`Remove chit: ${comment}`} title="Remove chit" />
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
            {addingCustomComment && !isDefaultBank && (
              <div className="mt-1.5 shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 p-1.5 dark:border-indigo-900 dark:bg-indigo-950/40">
                <label htmlFor="custom-inline-comment" className="text-[9px] font-bold text-indigo-700 dark:text-indigo-200">
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
                    className="min-w-0 flex-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] text-slate-900 outline-none ring-indigo-500 focus:ring-2 dark:border-indigo-800 dark:bg-slate-950 dark:text-white"
                  />
                  <button
                    type="button"
                    disabled={!customCommentDraft.trim()}
                    onClick={addCustomComment}
                    className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
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
            className="mt-2 min-h-[3.25rem] w-full shrink-0 resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          {commentError && (
            <p className="mt-1 shrink-0 text-[11px] font-semibold leading-relaxed text-red-600 dark:text-red-300">
              {commentError}
            </p>
          )}
          <div className="mt-1.5 flex shrink-0 items-center justify-end gap-2">
            <p className="mr-auto text-[9px] font-semibold text-slate-400">Click chit to send · Shift+click stacks · Shift+Return new line</p>
            <div className="flex gap-1.5">
              <button type="button" onClick={closePending} className="rounded-md px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
              <button type="button" disabled={!draftNote.trim()} onClick={addComment} className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">Add comment</button>
            </div>
          </div>
        </div>
      )}

      {openMarker && openMarkerPos && (
        <div
          data-teacher-annotation-ui
          className="fixed z-[70] w-[280px] rounded-2xl border border-indigo-200 bg-white p-3 shadow-2xl dark:border-indigo-800 dark:bg-slate-900"
          style={{ top: openMarkerPos.top, left: openMarkerPos.left }}
        >
          <CloseButton onClick={() => setOpenMarker(null)} label="Close" className="float-right" />
          <p className={`text-[10px] font-black uppercase tracking-[0.13em] ${
            openMarker.annotation.status === 'fixed'
              ? 'text-emerald-600 dark:text-emerald-300'
              : 'text-indigo-600 dark:text-indigo-300'
          }`}>
            {openMarker.annotation.status === 'fixed' ? 'Student marked fixed' : 'Your inline comment'}
          </p>
          <p className="mt-1 line-clamp-2 text-xs italic text-slate-500 dark:text-slate-400">“{openMarker.annotation.quote}”</p>
          <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-slate-800 dark:text-slate-100">{openMarker.annotation.note}</p>
          {openMarker.detached && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              The student changed the original highlighted passage.
            </p>
          )}
          {reviewError && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{reviewError}</p>}
          {openMarker.annotation.status === 'fixed' ? (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                disabled={reviewBusyId === openMarker.annotation.id}
                onClick={() => reviewFixedComment(openMarker, 'confirm')}
                className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Confirm fixed
              </button>
              <button
                type="button"
                disabled={reviewBusyId === openMarker.annotation.id}
                onClick={() => reviewFixedComment(openMarker, 'reopen')}
                className="w-full rounded-lg bg-amber-100 px-3 py-2 text-xs font-black text-amber-900 hover:bg-amber-200 disabled:opacity-50"
              >
                Needs another look
              </button>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => editComment(openMarker)} className="rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-bold text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-200">Edit</button>
                <button type="button" onClick={() => deleteComment(openMarker)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300">Delete</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => editComment(openMarker)} className="rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-bold text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-200">Edit</button>
              <button type="button" onClick={() => deleteComment(openMarker)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300">Delete</button>
            </div>
          )}
        </div>
      )}

      {saveNotice && (
        <div
          data-teacher-annotation-ui
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-xl border border-emerald-300 bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-2xl"
        >
          ✓ {saveNotice}
        </div>
      )}
    </>
  );
}
