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
const MAX_FAVOURITES = 8;
const PENDING_WIDTH = 468;
const PENDING_HEIGHT = 480;
const OPEN_WIDTH = 280;
const OPEN_HEIGHT = 220;
const MARKER_SIZE = 28;
const MARKER_MARGIN = 6;
/** Flat bank — no category menus. Favourites float above via local pin order. */
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

function loadCustomComments() {
  if (typeof window === 'undefined') return [];
  try {
    return normalizeCommentList(JSON.parse(localStorage.getItem(CUSTOM_COMMENTS_KEY) || '[]'), 30);
  } catch {
    return [];
  }
}

function saveCustomComments(comments) {
  try {
    localStorage.setItem(CUSTOM_COMMENTS_KEY, JSON.stringify(comments.slice(0, 30)));
  } catch {
    /* ignore storage failures */
  }
}

function loadFavouriteComments(known) {
  if (typeof window === 'undefined') return [];
  try {
    const knownSet = new Set(known);
    return normalizeCommentList(JSON.parse(localStorage.getItem(FAVOURITE_COMMENTS_KEY) || '[]'), MAX_FAVOURITES).filter(
      (item) => knownSet.has(item)
    );
  } catch {
    return [];
  }
}

function saveFavouriteComments(comments) {
  try {
    localStorage.setItem(FAVOURITE_COMMENTS_KEY, JSON.stringify(comments.slice(0, MAX_FAVOURITES)));
  } catch {
    /* ignore storage failures */
  }
}

function orderQuickComments(core, customs, favourites) {
  const bank = [...core, ...customs];
  const bankSet = new Set(bank);
  const pinned = favourites.filter((item) => bankSet.has(item));
  const pinnedSet = new Set(pinned);
  return [...pinned, ...bank.filter((item) => !pinnedSet.has(item))];
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

function detachedMarkerPosition(paneRect, index) {
  if (!paneRect.width || !paneRect.height) return null;
  return {
    top: paneRect.top + MARKER_MARGIN + index * (MARKER_SIZE + 4),
    left: paneRect.right - MARKER_SIZE - MARKER_MARGIN,
    position: 'fixed',
  };
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
  const [customComments, setCustomComments] = useState(loadCustomComments);
  const [favouriteComments, setFavouriteComments] = useState(() =>
    loadFavouriteComments([...CORE_COMMENTS, ...loadCustomComments()])
  );
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
  const draftNoteLatestRef = useRef('');
  const quickPrefixRef = useRef('');

  const orderedQuickComments = useMemo(
    () => orderQuickComments(CORE_COMMENTS, customComments, favouriteComments),
    [customComments, favouriteComments]
  );
  const favouriteSet = useMemo(() => new Set(favouriteComments), [favouriteComments]);
  const customSet = useMemo(() => new Set(customComments), [customComments]);

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
            const position = detachedMarkerPosition(paneRect, detachedCount);
            if (position) {
              nextMarkers.push({
                studentId,
                annotation,
                detached: true,
                top: position.top,
                left: position.left,
                position: 'fixed',
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
      if (target?.closest?.('[data-teacher-annotation-ui]')) return;
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        setPending(null);
        setQuickStack([]);
        draftNoteLatestRef.current = '';
        quickPrefixRef.current = '';
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
      setPending({
        studentId: card.studentId,
        ...offsets,
        ...clampFixedBox({
          top: rect.bottom + 8,
          left: rect.left,
          width: Math.min(PENDING_WIDTH, window.innerWidth - 20),
          height: PENDING_HEIGHT,
          padding: 10,
        }),
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

  function undoQuickComment() {
    setQuickStack((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice(0, -1);
      writeQuickDraft(quickPrefixRef.current, next);
      return next;
    });
  }

  function addCustomComment() {
    const comment = customCommentDraft.trim().slice(0, 500);
    if (!comment) return;
    const allComments = [...CORE_COMMENTS, ...customComments];
    const existing = allComments.find((item) => item.toLocaleLowerCase() === comment.toLocaleLowerCase());
    if (existing) {
      applyQuickComment(existing, { forceAdd: true });
      setCustomCommentDraft('');
      setAddingCustomComment(false);
      return;
    }
    const nextCustoms = [...customComments, comment].slice(0, 30);
    setCustomComments(nextCustoms);
    saveCustomComments(nextCustoms);
    applyQuickComment(comment, { forceAdd: true });
    setCustomCommentDraft('');
    setAddingCustomComment(false);
  }

  function removeCustomComment(comment) {
    const next = customComments.filter((item) => item !== comment);
    setCustomComments(next);
    saveCustomComments(next);
    if (favouriteSet.has(comment)) {
      const nextFavs = favouriteComments.filter((item) => item !== comment);
      setFavouriteComments(nextFavs);
      saveFavouriteComments(nextFavs);
    }
    setQuickStack((prev) => {
      if (!prev.includes(comment)) return prev;
      const stack = prev.filter((item) => item !== comment);
      writeQuickDraft(quickPrefixRef.current, stack);
      return stack;
    });
  }

  function toggleFavouriteComment(comment) {
    setFavouriteComments((prev) => {
      let next;
      if (prev.includes(comment)) {
        next = prev.filter((item) => item !== comment);
      } else if (prev.length >= MAX_FAVOURITES) {
        return prev;
      } else {
        next = [...prev, comment];
      }
      saveFavouriteComments(next);
      return next;
    });
  }

  function addComment() {
    const note = draftNote.trim();
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
    const ok = await confirmDialog({
      title: 'Delete this inline comment?',
      message: 'This removes the highlight and note from the student’s writing.',
      confirmLabel: 'Delete comment',
      tone: 'danger',
    });
    if (!ok) return;
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
          data-teacher-annotation-ui
          className="fixed z-[70] max-h-[calc(100vh-20px)] max-w-[calc(100vw-20px)] overflow-y-auto rounded-2xl border border-indigo-200 bg-white p-3 shadow-2xl dark:border-indigo-800 dark:bg-slate-900"
          style={{ top: pending.top, left: pending.left, width: Math.min(PENDING_WIDTH, typeof window !== 'undefined' ? window.innerWidth - 20 : PENDING_WIDTH) }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.13em] text-indigo-600">Selected passage</p>
              <p className="mt-1 line-clamp-3 text-xs italic text-slate-500 dark:text-slate-400">“{pending.quote}”</p>
            </div>
            <button
              type="button"
              onClick={copyPendingSelection}
              className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-black text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
            >
              Copy selection
            </button>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  Quick comments
                </p>
                <p className="mt-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500">
                  ★ pins to top · max {MAX_FAVOURITES}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={undoQuickComment}
                  disabled={!quickStack.length}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-35 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  aria-label="Undo last quick comment"
                  title="Undo last quick comment"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H13" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingCustomComment((open) => !open);
                    setCustomCommentDraft('');
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-sm font-black text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-200"
                  aria-label="Add a reusable comment"
                  title="Add your own quick comment"
                >
                  +
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {orderedQuickComments.map((comment) => {
                const selected = quickStack.includes(comment);
                const pinned = favouriteSet.has(comment);
                const isCustom = customSet.has(comment);
                const pinBlocked = !pinned && favouriteComments.length >= MAX_FAVOURITES;
                return (
                  <span
                    key={comment}
                    className={`inline-flex max-w-full items-stretch overflow-hidden rounded-md border text-[10px] font-semibold leading-snug transition ${
                      selected
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : pinned
                          ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
                          : isCustom
                            ? 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                            : 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => applyQuickComment(comment)}
                      className="max-w-[17rem] px-1.5 py-1 text-left hover:brightness-95"
                    >
                      {comment}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavouriteComment(comment)}
                      disabled={pinBlocked}
                      className={`shrink-0 border-l border-current/15 px-1.5 ${
                        pinned ? 'text-amber-600 dark:text-amber-300' : 'text-current/45 hover:text-amber-600'
                      } disabled:cursor-not-allowed disabled:opacity-30`}
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
                    {isCustom && (
                      <button
                        type="button"
                        onClick={() => removeCustomComment(comment)}
                        className="shrink-0 border-l border-current/15 px-1.5 text-current/55 hover:text-red-600"
                        aria-label={`Remove reusable comment: ${comment}`}
                        title="Remove quick comment"
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            {addingCustomComment && (
              <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 p-2 dark:border-indigo-900 dark:bg-indigo-950/40">
                <label htmlFor="custom-inline-comment" className="text-[10px] font-bold text-indigo-700 dark:text-indigo-200">
                  New reusable comment
                </label>
                <div className="mt-1.5 flex gap-1.5">
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
                    className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none ring-indigo-500 focus:ring-2 dark:border-indigo-800 dark:bg-slate-950 dark:text-white"
                  />
                  <button
                    type="button"
                    disabled={!customCommentDraft.trim()}
                    onClick={addCustomComment}
                    className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
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
            placeholder="Type your comment… Return to add · Shift+Return for a new line"
            className="mt-3 min-h-20 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          {commentError && (
            <p className="mt-2 text-xs font-semibold leading-relaxed text-red-600 dark:text-red-300">
              {commentError}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold text-slate-400">Return adds · Shift+Return new line</p>
            <div className="flex gap-2">
              <button type="button" onClick={closePending} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
              <button type="button" disabled={!draftNote.trim()} onClick={addComment} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">Add comment</button>
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
          <button type="button" onClick={() => setOpenMarker(null)} className="float-right text-sm font-black text-slate-400 hover:text-slate-700">×</button>
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
