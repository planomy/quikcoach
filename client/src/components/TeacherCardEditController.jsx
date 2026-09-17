import { CloseButton } from './PanelActions.jsx';
import { useEffect, useRef, useState } from 'react';
import { confirmDialog } from './ConfirmDialogHost.jsx';

function currentSocket() {
  if (typeof window === 'undefined') return null;
  return window.__iboardTeacherSocket || null;
}

/**
 * Edit-card modal for teacher board posts.
 * The pencil control lives in TeacherDashboard (with HintWrap) and dispatches
 * `iboard:edit-teacher-card` — we no longer inject a DOM button next to Remove,
 * which was stealing the Remove hint and then showing a native title tooltip.
 */
export default function TeacherCardEditController() {
  const [socket, setSocket] = useState(currentSocket);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closePending = useRef(false);
  const studentIdsRef = useRef([]);

  useEffect(() => {
    const onTeacherSocket = (event) => {
      const next = event.detail?.socket || currentSocket();
      if (next) setSocket(next);
    };
    window.addEventListener('iboard:teacher-socket', onTeacherSocket);
    if (currentSocket()) setSocket(currentSocket());
    return () => window.removeEventListener('iboard:teacher-socket', onTeacherSocket);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onRoom = (payload) => {
      const students = Array.isArray(payload?.students) ? payload.students : [];
      studentIdsRef.current = students.map((s) => Number(s.id)).filter((id) => id > 0);
    };
    socket.on('room:state', onRoom);
    return () => socket.off('room:state', onRoom);
  }, [socket]);

  useEffect(() => {
    const onEdit = (event) => {
      const post = event.detail?.post;
      if (!post?.id) return;
      setEditing(post);
      setTitle(String(post.title || 'Teacher'));
      setText(String(post.text || ''));
      setError('');
    };
    window.addEventListener('iboard:edit-teacher-card', onEdit);
    return () => window.removeEventListener('iboard:edit-teacher-card', onEdit);
  }, []);

  // Strip any leftover injected edit buttons from older builds still in the DOM.
  useEffect(() => {
    const wipe = () => {
      document.querySelectorAll('[data-iboard-teacher-edit="true"]').forEach((node) => node.remove());
    };
    wipe();
    const observer = new MutationObserver(() => wipe());
    const main = document.querySelector('main');
    if (main) observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function closeEditor() {
    if (busy || closePending.current) return;
    if (editing && (title !== String(editing.title || 'Teacher') || text !== String(editing.text || ''))) {
      closePending.current = true;
      const discard = await confirmDialog({
        title: 'Discard card changes?',
        message: 'Your unsaved edits will be lost.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
      });
      closePending.current = false;
      if (!discard) return;
    }
    setEditing(null);
    setError('');
  }

  function save(rebroadcast = false) {
    if (!socket || !editing?.id || busy) return;
    const cleanTitle = title.trim() || 'Teacher';
    const cleanText = text.trim();
    if (editing.kind !== 'image' && !cleanText) {
      setError('Teacher card cannot be empty.');
      return;
    }

    setBusy(true);
    setError('');
    window.dispatchEvent(new CustomEvent('iboard:teacher-save-status', { detail: { status: 'saving' } }));
    socket.emit(
      'teacher:board-post-update',
      { postId: editing.id, title: cleanTitle, text: cleanText },
      (ack) => {
        if (!ack?.ok) {
          setBusy(false);
          setError(ack?.error || 'Could not update teacher card.');
          window.dispatchEvent(new CustomEvent('iboard:teacher-save-status', { detail: { status: 'error' } }));
          return;
        }
        if (!rebroadcast) {
          setBusy(false);
          setEditing(null);
          window.dispatchEvent(new CustomEvent('iboard:teacher-save-status', { detail: { status: 'saved' } }));
          return;
        }
        // Text cards → durable Inbox notes (not Broadcast exemplars).
        // Image cards → class Broadcast so students still get the media.
        if (editing.kind === 'image') {
          socket.emit('teacher:broadcast', { studentIds: [], postIds: [editing.id] }, (broadcastAck) => {
            setBusy(false);
            if (!broadcastAck?.ok) {
              setError(broadcastAck?.error || 'Card saved, but sending to Inbox failed.');
              window.dispatchEvent(new CustomEvent('iboard:teacher-save-status', { detail: { status: 'error' } }));
              return;
            }
            setEditing(null);
            window.dispatchEvent(new CustomEvent('iboard:teacher-save-status', { detail: { status: 'saved' } }));
          });
          return;
        }
        const noteText = `${cleanTitle}: ${cleanText}`.slice(0, 4000);
        const recipients = studentIdsRef.current.map((studentId) => ({ studentId, text: noteText }));
        if (!recipients.length) {
          setBusy(false);
          setError('Card saved, but no students are in the room to receive Inbox.');
          window.dispatchEvent(new CustomEvent('iboard:teacher-save-status', { detail: { status: 'error' } }));
          return;
        }
        socket.emit('teacher:distribute', { items: recipients }, (distAck) => {
          setBusy(false);
          if (!distAck?.ok) {
            setError(distAck?.error || 'Card saved, but sending to Inbox failed.');
            window.dispatchEvent(new CustomEvent('iboard:teacher-save-status', { detail: { status: 'error' } }));
            return;
          }
          setEditing(null);
          window.dispatchEvent(new CustomEvent('iboard:teacher-save-status', { detail: { status: 'saved' } }));
        });
      }
    );
  }

  if (!editing) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/55 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeEditor();
      }}
    >
      <form
        className="w-full max-w-md overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl dark:border-indigo-800 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-teacher-card-title"
        onSubmit={(event) => {
          event.preventDefault();
          save(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') closeEditor();
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">Teacher card</p>
            <h2 id="edit-teacher-card-title" className="mt-1 font-display text-lg font-black text-slate-950 dark:text-white">Edit card</h2>
          </div>
          <CloseButton disabled={busy} onClick={closeEditor} aria-label="Close editor" title="" />
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Title</label>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value.slice(0, 80))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          {editing.kind === 'image' ? (
            <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              Image stays as it is. Edit the title, then save or send to Inbox.
            </p>
          ) : (
            <>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Text</label>
              <textarea
                rows={6}
                value={text}
                onChange={(event) => setText(event.target.value.slice(0, 20000))}
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-relaxed text-slate-900 outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </>
          )}
          {error && <p className="text-sm font-bold text-red-600 dark:text-red-300">{error}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-950">
          <button type="button" disabled={busy} onClick={closeEditor} className="rounded-xl px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-200 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200 dark:hover:bg-indigo-950/40">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" disabled={busy} onClick={() => save(true)} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? 'Saving…' : 'Save & send to Inbox'}
          </button>
        </div>
      </form>
    </div>
  );
}
