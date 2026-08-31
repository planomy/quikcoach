import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  plainTextFromElement,
  rangeForPlainOffsets,
  resolveAnnotation,
  selectionOffsetsWithin,
} from '../lib/annotations.js';
import { clampFixedBox, placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges } from '../lib/viewport.js';

const HIGHLIGHT_NAME = 'iboard-teacher-inline-comments';
const FIXED_HIGHLIGHT_NAME = 'iboard-teacher-fixed-comments';
const CUSTOM_COMMENTS_KEY = 'iboard-teacher-custom-inline-comments';
const PENDING_WIDTH = 360;
const PENDING_HEIGHT = 460;
const OPEN_WIDTH = 280;
const OPEN_HEIGHT = 220;
const MARKER_SIZE = 28;
const MARKER_GAP = 5;
const MARKER_MARGIN = 6;
const CORE_COMMENTS = [
  'Check GPS',
  'This is an incomplete fragment sentence',
  'Repeated word or idea',
  "I'm not following what you mean",
  'Too many little words',
  'Change this',
  'Love this',
];

function loadCustomComments() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_COMMENTS_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || '').trim().slice(0, 500)).filter(Boolean).slice(0, 30)
      : [];
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
  const article =
    document.querySelector(`article[data-student-id="${Number(studentId)}"]`) ||
    document.querySelector(`h2[title="ID #${Number(studentId)}"]`)?.closest('article');
  const textPane =
    article?.querySelector('[data-student-writing-pane]') || article?.querySelector('div.max-h-52');
  return article && textPane ? { article, textPane } : null;
}

function markerPosition(rangeRect, card) {
  if (typeof window === 'undefined' || !card?.article || !card?.textPane) return null;

  const paneRect = card.textPane.getBoundingClientRect();
  const cardRect = card.article.getBoundingClientRect();
  const visible = {
    top: Math.max(0, paneRect.top, cardRect.top),
    bottom: Math.min(window.innerHeight, paneRect.bottom, cardRect.bottom),
    left: Math.max(0, paneRect.left, cardRect.left),
    right: Math.min(window.innerWidth, paneRect.right, cardRect.right),
  };

  if (
    visible.bottom - visible.top < MARKER_SIZE ||
    visible.right <= visible.left ||
    rangeRect.bottom < visible.top ||
    rangeRect.top > visible.bottom ||
    rangeRect.right < visible.left ||
    rangeRect.left > visible.right
  ) {
    return null;
  }

  return {
    top: Math.min(
      Math.max(rangeRect.top - 3, visible.top + 2),
      visible.bottom - MARKER_SIZE - 2
    ),
    left: Math.min(
      window.innerWidth - MARKER_SIZE - MARKER_MARGIN,
      Math.max(MARKER_MARGIN, rangeRect.right + MARKER_GAP)
    ),
  };
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
  const [customComments, setCustomComments] = useState(loadCustomComments);
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
      const fullText = plainTextFromElement(card.textPane);
      const paneRect = card.textPane.getBoundingClientRect();
      let detachedCount = 0;
      for (const annotation of annotations || []) {
        const fixed = annotation.status === 'fixed';
        const resolved = resolveAnnotation(annotation, fullText);
        const range = resolved.detached ? null : rangeForPlainOffsets(card.textPane, resolved.start, resolved.end);
        if (!range) {
          if (paneRect.bottom > 0 && paneRect.top < window.innerHeight) {
            nextMarkers.push({
              studentId,
              annotation,
              detached: true,
              top: Math.max(6, Math.min(window.innerHeight - MARKER_SIZE - 6, paneRect.top + 8 + detachedCount * (MARKER_SIZE + 4))),
              left: Math.max(6, Math.min(window.innerWidth - MARKER_SIZE - 6, paneRect.right - MARKER_SIZE - 6)),
            });
            detachedCount += 1;
          }
          continue;
        }
        (fixed ? fixedRanges : ranges).push(range);
        const rect = range.getBoundingClientRect();
        if (rect.width || rect.height) {
          const position = markerPosition(rect, card);
          if (!position) continue;
          nextMarkers.push({
            studentId,
            annotation,
            detached: false,
            ...position,
          });
        }
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
    const unsubscribe = subscribeViewportChanges(onMove);
    window.addEventListener('iboard:teacher-layout', onMove);
    return () => {
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
        return;
      }
      const range = selection.getRangeAt(0);
      const card = findCardFromNode(range.startContainer);
      if (!card || !card.textPane.contains(range.endContainer)) return;
      const fullText = plainTextFromElement(card.textPane);
      const offsets = selectionOffsetsWithin(card.textPane, fullText);
      if (!offsets || offsets.quote.length > 1200) return;
      const rect = range.getBoundingClientRect();
      setDraftNote('');
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

  function addCustomComment() {
    const comment = customCommentDraft.trim().slice(0, 500);
    if (!comment) return;
    const allComments = [...CORE_COMMENTS, ...customComments];
    const existing = allComments.find((item) => item.toLocaleLowerCase() === comment.toLocaleLowerCase());
    if (existing) {
      setDraftNote(existing);
      setCustomCommentDraft('');
      setAddingCustomComment(false);
      return;
    }
    const next = [...customComments, comment].slice(0, 30);
    setCustomComments(next);
    saveCustomComments(next);
    setDraftNote(comment);
    setCustomCommentDraft('');
    setAddingCustomComment(false);
  }

  function removeCustomComment(comment) {
    const next = customComments.filter((item) => item !== comment);
    setCustomComments(next);
    saveCustomComments(next);
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
        setPending(null);
        setDraftNote('');
        setCommentError('');
        setSaveNotice(`Inline comment saved for “${quotedText}”`);
        window.getSelection?.()?.removeAllRanges?.();
      }
    );
  }

  function editComment(marker) {
    if (!socket) return;
    const next = window.prompt('Edit teacher comment:', marker.annotation.note || '');
    if (next == null) return;
    const note = String(next).trim();
    if (!note) return;
    socket.emit('teacher:annotation-update', { annotationId: marker.annotation.id, note });
    setOpenMarker(null);
  }

  function deleteComment(marker) {
    if (!socket) return;
    if (!window.confirm('Delete this inline teacher comment?')) return;
    socket.emit('teacher:annotation-delete', { annotationId: marker.annotation.id });
    setOpenMarker(null);
  }

  function bulkConfirmFixed(studentId = 0) {
    if (!socket || bulkBusy || fixedCount <= 0) return;
    const scope = studentId > 0 ? 'this student' : 'the whole room';
    const ok = window.confirm(
      `Confirm all ${fixedCount} student-fixed comment${fixedCount === 1 ? '' : 's'} for ${scope}?\n\nThey will be cleared from the board.`
    );
    if (!ok) return;
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
        setSaveNotice(`Cleared ${ack.count || fixedCount} fixed comment${(ack.count || fixedCount) === 1 ? '' : 's'}`);
      }
    );
  }

  const openMarkerPos = openMarker
    ? placementNearAnchor({
        anchor: {
          top: openMarker.top,
          left: openMarker.left,
          right: openMarker.left + MARKER_SIZE,
          bottom: openMarker.top + MARKER_SIZE,
          width: MARKER_SIZE,
          height: MARKER_SIZE,
        },
        width: OPEN_WIDTH,
        height: OPEN_HEIGHT,
        gap: 10,
        prefer: 'below',
      })
    : null;

  return (
    <>
      <style>{`
        ::highlight(${HIGHLIGHT_NAME}) { background: rgba(196, 181, 253, 0.72); text-decoration: underline 2px rgb(124, 58, 237); text-underline-offset: 2px; }
        ::highlight(${FIXED_HIGHLIGHT_NAME}) { background: rgba(167, 243, 208, 0.58); text-decoration: underline 2px rgb(16, 185, 129); text-underline-offset: 2px; }
      `}</style>

      {markers.map((marker) => (
        <button
          key={`${marker.studentId}-${marker.annotation.id}`}
          data-teacher-annotation-ui
          type="button"
          onClick={() => {
            setReviewError('');
            setOpenMarker(marker);
          }}
          className={`fixed z-[45] flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-black text-white shadow-lg transition ${
            marker.annotation.status === 'fixed'
              ? 'bg-emerald-500/75 hover:bg-emerald-600'
              : 'bg-violet-600 hover:bg-violet-700'
          }`}
          style={{ top: marker.top, left: marker.left }}
          title={marker.annotation.status === 'fixed' ? `Student marked fixed: ${marker.annotation.note}` : marker.annotation.note}
          aria-label={marker.annotation.status === 'fixed' ? 'Review student fix' : 'Open inline teacher comment'}
        >
          {marker.annotation.status === 'fixed' ? '✓' : '💬'}
        </button>
      ))}

      {pending && (
        <div
          data-teacher-annotation-ui
          className="fixed z-[70] max-h-[calc(100vh-20px)] w-[360px] max-w-[calc(100vw-20px)] overflow-y-auto rounded-2xl border border-violet-200 bg-white p-3 shadow-2xl dark:border-violet-800 dark:bg-slate-900"
          style={{ top: pending.top, left: pending.left }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.13em] text-violet-600">Selected passage</p>
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
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                Quick comments
              </p>
              <button
                type="button"
                onClick={() => {
                  setAddingCustomComment((open) => !open);
                  setCustomCommentDraft('');
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-sm font-black text-violet-700 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-200"
                aria-label="Add a reusable comment"
                title="Add your own quick comment"
              >
                +
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CORE_COMMENTS.map((comment) => (
                <button
                  key={comment}
                  type="button"
                  onClick={() => setDraftNote(comment)}
                  className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold leading-tight transition ${
                    draftNote === comment
                      ? 'border-violet-600 bg-violet-600 text-white'
                      : 'border-violet-200 bg-violet-50 text-violet-800 hover:border-violet-400 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-200'
                  }`}
                >
                  {comment}
                </button>
              ))}
              {customComments.map((comment) => (
                <span
                  key={comment}
                  className={`inline-flex overflow-hidden rounded-lg border text-[11px] font-semibold leading-tight transition ${
                    draftNote === comment
                      ? 'border-violet-600 bg-violet-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  <button type="button" onClick={() => setDraftNote(comment)} className="px-2 py-1.5 text-left hover:bg-violet-100/70 dark:hover:bg-violet-950/70">
                    {comment}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCustomComment(comment)}
                    className="border-l border-current/20 px-1.5 text-current/60 hover:text-red-600"
                    aria-label={`Remove reusable comment: ${comment}`}
                    title="Remove quick comment"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {addingCustomComment && (
              <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-2 dark:border-violet-900 dark:bg-violet-950/40">
                <label htmlFor="custom-inline-comment" className="text-[10px] font-bold text-violet-700 dark:text-violet-200">
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
                    className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none ring-violet-500 focus:ring-2 dark:border-violet-800 dark:bg-slate-950 dark:text-white"
                  />
                  <button
                    type="button"
                    disabled={!customCommentDraft.trim()}
                    onClick={addCustomComment}
                    className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
          <textarea
            autoFocus
            value={draftNote}
            onChange={(event) => setDraftNote(event.target.value.slice(0, 500))}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') addComment();
              if (event.key === 'Escape') setPending(null);
            }}
            placeholder="Type your comment…"
            className="mt-3 min-h-20 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-violet-500 focus:border-violet-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          {commentError && (
            <p className="mt-2 text-xs font-semibold leading-relaxed text-red-600 dark:text-red-300">
              {commentError}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setPending(null)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
            <button type="button" disabled={!draftNote.trim()} onClick={addComment} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40">Add comment</button>
          </div>
        </div>
      )}

      {openMarker && openMarkerPos && (
        <div
          data-teacher-annotation-ui
          className="fixed z-[70] w-[280px] rounded-2xl border border-violet-200 bg-white p-3 shadow-2xl dark:border-violet-800 dark:bg-slate-900"
          style={{ top: openMarkerPos.top, left: openMarkerPos.left }}
        >
          <button type="button" onClick={() => setOpenMarker(null)} className="float-right text-sm font-black text-slate-400 hover:text-slate-700">×</button>
          <p className={`text-[10px] font-black uppercase tracking-[0.13em] ${
            openMarker.annotation.status === 'fixed'
              ? 'text-emerald-600 dark:text-emerald-300'
              : 'text-violet-600 dark:text-violet-300'
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
                <button type="button" onClick={() => editComment(openMarker)} className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-200">Edit</button>
                <button type="button" onClick={() => deleteComment(openMarker)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300">Delete</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => editComment(openMarker)} className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-200">Edit</button>
              <button type="button" onClick={() => deleteComment(openMarker)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300">Delete</button>
            </div>
          )}
        </div>
      )}

      {fixedCount > 0 && (
        <div
          data-teacher-annotation-ui
          className="fixed bottom-4 right-4 z-[75] flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-white px-3 py-2 shadow-2xl dark:border-emerald-900 dark:bg-slate-900"
        >
          <span className="text-xs font-bold text-emerald-800 dark:text-emerald-200">
            {fixedCount} fixed — ready to clear
          </span>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => bulkConfirmFixed(0)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {bulkBusy ? 'Clearing…' : 'Confirm all fixed'}
          </button>
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
