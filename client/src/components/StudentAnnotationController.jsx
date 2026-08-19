import { useCallback, useEffect, useState } from 'react';
import { plainTextFromElement, rangeForPlainOffsets, resolveAnnotation } from '../lib/annotations.js';

const HIGHLIGHT_NAME = 'iboard-student-inline-comments';
const DISMISSED_STORAGE_PREFIX = 'iboard-dismissed-inline-comments';

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

function annotationVersionKey(annotation) {
  return `${Number(annotation?.id) || 0}\u0000${String(annotation?.updated_at || '')}\u0000${String(annotation?.note || '')}`;
}

function loadDismissedAnnotations(studentId) {
  if (typeof window === 'undefined' || !studentId) return [];
  try {
    const raw = localStorage.getItem(`${DISMISSED_STORAGE_PREFIX}:${studentId}`) || '[]';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function saveDismissedAnnotations(studentId, keys) {
  if (typeof window === 'undefined' || !studentId) return;
  try {
    localStorage.setItem(
      `${DISMISSED_STORAGE_PREFIX}:${studentId}`,
      JSON.stringify(keys.slice(-500))
    );
  } catch {
    /* ignore storage failures */
  }
}

export default function StudentAnnotationController({ socket, studentId: suppliedStudentId }) {
  const studentId = Number(suppliedStudentId) || currentStudentId();
  const [annotations, setAnnotations] = useState([]);
  const [dismissedAnnotationKeys, setDismissedAnnotationKeys] = useState(() =>
    loadDismissedAnnotations(studentId)
  );
  const [markers, setMarkers] = useState([]);
  const [openMarker, setOpenMarker] = useState(null);

  const refreshHighlights = useCallback(() => {
    if (typeof document === 'undefined') return;
    const editor = editorElement();
    if (!editor) {
      globalThis.CSS?.highlights?.delete?.(HIGHLIGHT_NAME);
      setMarkers([]);
      return;
    }
    const text = plainTextFromElement(editor);
    const ranges = [];
    const nextMarkers = [];
    const dismissed = new Set(dismissedAnnotationKeys);
    for (const annotation of annotations || []) {
      if (dismissed.has(annotationVersionKey(annotation))) continue;
      const resolved = resolveAnnotation(annotation, text);
      if (resolved.detached) continue;
      const range = rangeForPlainOffsets(editor, resolved.start, resolved.end);
      if (!range) continue;
      ranges.push(range);
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) {
        nextMarkers.push({
          annotation,
          top: Math.max(6, rect.top - 2),
          left: Math.min(window.innerWidth - 34, rect.right + 5),
        });
      }
    }
    if (globalThis.CSS?.highlights && typeof globalThis.Highlight !== 'undefined') {
      if (ranges.length) globalThis.CSS.highlights.set(HIGHLIGHT_NAME, new globalThis.Highlight(...ranges));
      else globalThis.CSS.highlights.delete(HIGHLIGHT_NAME);
    }
    setMarkers(nextMarkers);
  }, [annotations, dismissedAnnotationKeys]);

  useEffect(() => {
    setDismissedAnnotationKeys(loadDismissedAnnotations(studentId));
  }, [studentId]);

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
    const schedule = () => requestAnimationFrame(() => requestAnimationFrame(refreshHighlights));
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
        // Watch only until the student joins and the editor is mounted.
        observer.observe(document.body, { childList: true, subtree: true });
      }
      schedule();
    };
    const onInput = (event) => {
      if (event.target?.matches?.('[role="textbox"][contenteditable]')) schedule();
    };
    document.addEventListener('input', onInput, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('iboard:room-state', attachObserver);
    attachObserver();
    const id = requestAnimationFrame(() => requestAnimationFrame(refreshHighlights));
    return () => {
      cancelAnimationFrame(id);
      observer.disconnect();
      document.removeEventListener('input', onInput, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('iboard:room-state', attachObserver);
      globalThis.CSS?.highlights?.delete?.(HIGHLIGHT_NAME);
    };
  }, [refreshHighlights]);

  function dismissComment(marker) {
    const key = annotationVersionKey(marker?.annotation);
    if (!key) return;
    setDismissedAnnotationKeys((previous) => {
      if (previous.includes(key)) return previous;
      const next = [...previous, key];
      saveDismissedAnnotations(studentId, next);
      return next;
    });
    setMarkers((previous) =>
      previous.filter((item) => Number(item.annotation?.id) !== Number(marker.annotation?.id))
    );
    setOpenMarker(null);
  }

  return (
    <>
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background: rgba(196, 181, 253, 0.78); text-decoration: underline 2px rgb(124, 58, 237); text-underline-offset: 2px; }`}</style>
      {markers.map((marker) => (
        <button
          key={marker.annotation.id}
          data-teacher-annotation-ui
          type="button"
          onClick={() => setOpenMarker(marker)}
          className="fixed z-[50] flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-violet-600 text-xs font-black text-white shadow-lg hover:bg-violet-700"
          style={{ top: marker.top, left: marker.left }}
          title="Teacher comment"
          aria-label="Open teacher comment"
        >
          💬
        </button>
      ))}
      {openMarker && (
        <div
          data-teacher-annotation-ui
          className="fixed z-[70] w-[290px] rounded-2xl border border-violet-200 bg-white p-4 shadow-2xl dark:border-violet-800 dark:bg-slate-900"
          style={{
            top: Math.max(10, Math.min(window.innerHeight - 200, openMarker.top + 30)),
            left: Math.max(10, Math.min(window.innerWidth - 300, openMarker.left - 250)),
          }}
        >
          <button
            type="button"
            onClick={() => dismissComment(openMarker)}
            className="float-right text-lg font-black text-slate-400 hover:text-slate-700"
            aria-label="Dismiss teacher comment"
            title="Dismiss comment"
          >
            ×
          </button>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">Teacher comment</p>
          <p className="mt-1 line-clamp-2 text-xs italic text-slate-500 dark:text-slate-400">“{openMarker.annotation.quote}”</p>
          <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-800 dark:text-slate-100">{openMarker.annotation.note}</p>
        </div>
      )}
    </>
  );
}
