import { useEffect, useRef, useState } from 'react';

function currentSocket() {
  if (typeof window === 'undefined') return null;
  return window.__iboardTeacherSocket || null;
}

function currentRoomCode() {
  if (typeof window === 'undefined') return '';
  const stored = String(window.__iboardTeacherRoomCode || '').replace(/\D/g, '').slice(0, 4);
  if (stored.length === 4) return stored;
  const header = [...document.querySelectorAll('header h1')].find((node) => /Room\s+\d{4}/.test(node.textContent || ''));
  return String(header?.textContent || '').match(/Room\s+(\d{4})/)?.[1] || '';
}

function teacherCardArticles() {
  return [...document.querySelectorAll('main article')].filter((article) =>
    [...article.querySelectorAll('span')].some((span) => span.textContent?.trim().toLowerCase() === 'teacher')
    && !!article.querySelector('button[title="Remove teacher card"]')
  );
}

function makeEditButton(post) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.iboardTeacherEdit = 'true';
  button.className = 'grid h-6 w-6 shrink-0 place-items-center rounded-md text-indigo-500 transition hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-100';
  button.title = 'Edit teacher card';
  button.setAttribute('aria-label', 'Edit teacher card');
  button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent('iboard:edit-teacher-card', { detail: { post } }));
  });
  return button;
}

export default function TeacherCardEditController() {
  const [socket, setSocket] = useState(currentSocket);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const postsRef = useRef([]);
  const observerRef = useRef(null);

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

  useEffect(() => {
    if (!socket) return undefined;

    const decorate = () => {
      const posts = postsRef.current;
      const cards = teacherCardArticles();
      cards.forEach((article, index) => {
        const post = posts[index];
        if (!post?.id) return;
        article.dataset.teacherPostId = String(post.id);
        const existing = article.querySelector('[data-iboard-teacher-edit="true"]');
        if (existing) return;
        const remove = article.querySelector('button[title="Remove teacher card"]');
        if (!remove?.parentElement) return;
        remove.parentElement.insertBefore(makeEditButton(post), remove);
      });
    };

    const onRoom = (payload) => {
      postsRef.current = Array.isArray(payload?.posts) ? payload.posts : [];
      requestAnimationFrame(decorate);
    };

    socket.on('room:state', onRoom);
    observerRef.current = new MutationObserver(() => requestAnimationFrame(decorate));
    observerRef.current.observe(document.body, { childList: true, subtree: true });

    const code = currentRoomCode();
    if (code.length === 4) {
      socket.emit('teacher:join', { code });
    }
    requestAnimationFrame(decorate);

    return () => {
      socket.off('room:state', onRoom);
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [socket]);

  function closeEditor() {
    if (busy) return;
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
    socket.emit(
      'teacher:board-post-update',
      { postId: editing.id, title: cleanTitle, text: cleanText },
      (ack) => {
        if (!ack?.ok) {
          setBusy(false);
          setError(ack?.error || 'Could not update teacher card.');
          return;
        }
        if (!rebroadcast) {
          setBusy(false);
          setEditing(null);
          return;
        }
        socket.emit('teacher:broadcast', { studentIds: [], postIds: [editing.id] }, (broadcastAck) => {
          setBusy(false);
          if (!broadcastAck?.ok) {
            setError(broadcastAck?.error || 'Card saved, but rebroadcast failed.');
            return;
          }
          setEditing(null);
        });
      }
    );
  }

  if (!editing) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/55 p-4 sm:items-center" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeEditor();
    }}>
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
          <button type="button" disabled={busy} onClick={closeEditor} className="grid h-9 w-9 place-items-center rounded-lg text-xl font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Close editor">×</button>
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
            <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400">Image stays as it is. Edit the title, then save or rebroadcast.</p>
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
          <button type="button" disabled={busy} onClick={closeEditor} className="rounded-xl px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-200 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200 dark:hover:bg-indigo-950/40">{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" disabled={busy} onClick={() => save(true)} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-40">{busy ? 'Saving…' : 'Save & rebroadcast'}</button>
        </div>
      </form>
    </div>
  );
}
