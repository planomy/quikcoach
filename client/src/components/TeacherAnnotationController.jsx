import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  plainTextFromElement,
  rangeForPlainOffsets,
  resolveAnnotation,
  selectionOffsetsWithin,
} from '../lib/annotations.js';

const HIGHLIGHT_NAME = 'iboard-teacher-inline-comments';

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
  const studentId = Number(match?.[1]);
  if (!studentId) return null;
  const textPane = el.closest('div.max-h-52') || article.querySelector('div.max-h-52');
  if (!textPane || !textPane.contains(el)) return null;
  return { article, textPane, studentId };
}

function cardForStudent(studentId) {
  const heading = document.querySelector(`h2[title="ID #${Number(studentId)}"]`);
  const article = heading?.closest('article');
  const textPane = article?.querySelector('div.max-h-52');
  return article && textPane ? { article, textPane } : null;
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
  const [commentError, setCommentError] = useState('');
  const [openMarker, setOpenMarker] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [detachedCount, setDetachedCount] = useState(0);

  const annotationTotal = useMemo(
    () => Object.values(byStudent).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0),
    [byStudent]
  );

  const refreshHighlights = useCallback(() => {
    if (typeof document === 'undefined') return;
    const ranges = [];
    const nextMarkers = [];
    let detached = 0;

    for (const [studentKey, annotations] of Object.entries(byStudent)) {
      const studentId = Number(studentKey);
      const card = cardForStudent(studentId);
      if (!card) continue;
      const fullText = plainTextFromElement(card.textPane);
      for (const annotation of annotations || []) {
        const resolved = resolveAnnotation(annotation, fullText);
        if (resolved.detached) {
          detached += 1;
          continue;
        }
        const range = rangeForPlainOffsets(card.textPane, resolved.start, resolved.end);
        if (!range) {
          detached += 1;
          continue;
        }
        ranges.push(range);
        const rect = range.getBoundingClientRect();
        if (rect.width || rect.height) {
          nextMarkers.push({
            studentId,
            annotation,
            top: Math.max(6, rect.top - 3),
            left: Math.min(window.innerWidth - 34, rect.right + 5),
          });
        }
      }
    }

    if (globalThis.CSS?.highlights && typeof globalThis.Highlight !== 'undefined') {
      if (ranges.length) globalThis.CSS.highlights.set(HIGHLIGHT_NAME, new globalThis.Highlight(...ranges));
      else globalThis.CSS.highlights.delete(HIGHLIGHT_NAME);
    }
    setMarkers(nextMarkers);
    setDetachedCount(detached);
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
    const onMove = () => refreshHighlights();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      globalThis.CSS?.highlights?.delete?.(HIGHLIGHT_NAME);
    };
  }, [refreshHighlights]);

  useEffect(() => {
    function onMouseUp() {
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
      setCommentError('');
      setPending({
        studentId: card.studentId,
        ...offsets,
        left: Math.max(10, Math.min(window.innerWidth - 310, rect.left)),
        top: Math.min(window.innerHeight - 180, rect.bottom + 8),
      });
      setOpenMarker(null);
    }
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  function addComment() {
    const note = draftNote.trim();
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
        setPending(null);
        setDraftNote('');
        setCommentError('');
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

  return (
    <>
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background: rgba(196, 181, 253, 0.72); text-decoration: underline 2px rgb(124, 58, 237); text-underline-offset: 2px; }`}</style>

      {markers.map((marker) => (
        <button
          key={`${marker.studentId}-${marker.annotation.id}`}
          data-teacher-annotation-ui
          type="button"
          onClick={() => setOpenMarker(marker)}
          className="fixed z-[45] flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-violet-600 text-xs font-black text-white shadow-lg hover:bg-violet-700"
          style={{ top: marker.top, left: marker.left }}
          title={marker.annotation.note}
          aria-label="Open inline teacher comment"
        >
          💬
        </button>
      ))}

      {pending && (
        <div
          data-teacher-annotation-ui
          className="fixed z-[70] w-[300px] rounded-2xl border border-violet-200 bg-white p-3 shadow-2xl dark:border-violet-800 dark:bg-slate-900"
          style={{ top: pending.top, left: pending.left }}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.13em] text-violet-600">Inline comment</p>
          <p className="mt-1 line-clamp-2 text-xs italic text-slate-500 dark:text-slate-400">“{pending.quote}”</p>
          <textarea
            autoFocus
            value={draftNote}
            onChange={(event) => setDraftNote(event.target.value.slice(0, 500))}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') addComment();
              if (event.key === 'Escape') setPending(null);
            }}
            placeholder="Type your comment…"
            className="mt-2 min-h-20 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-violet-500 focus:border-violet-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
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

      {openMarker && (
        <div
          data-teacher-annotation-ui
          className="fixed z-[70] w-[280px] rounded-2xl border border-violet-200 bg-white p-3 shadow-2xl dark:border-violet-800 dark:bg-slate-900"
          style={{
            top: Math.max(10, Math.min(window.innerHeight - 180, openMarker.top + 30)),
            left: Math.max(10, Math.min(window.innerWidth - 290, openMarker.left - 245)),
          }}
        >
          <button type="button" onClick={() => setOpenMarker(null)} className="float-right text-sm font-black text-slate-400 hover:text-slate-700">×</button>
          <p className="text-[10px] font-black uppercase tracking-[0.13em] text-violet-600">Your inline comment</p>
          <p className="mt-1 line-clamp-2 text-xs italic text-slate-500 dark:text-slate-400">“{openMarker.annotation.quote}”</p>
          <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-slate-800 dark:text-slate-100">{openMarker.annotation.note}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => editComment(openMarker)} className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-200">Edit</button>
            <button type="button" onClick={() => deleteComment(openMarker)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300">Delete</button>
          </div>
        </div>
      )}

      {detachedCount > 0 && (
        <div data-teacher-annotation-ui className="fixed bottom-4 left-4 z-40 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {detachedCount} inline {detachedCount === 1 ? 'comment is' : 'comments are'} waiting because the student changed that passage.
        </div>
      )}
    </>
  );
}
