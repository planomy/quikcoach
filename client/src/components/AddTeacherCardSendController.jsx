import { useEffect, useRef, useState } from 'react';

function currentSocket() {
  return typeof window !== 'undefined' ? window.__iboardTeacherSocket || null : null;
}

function findAddCardDialog() {
  return document.querySelector('[data-iboard-add-card-panel="true"]')
    || [...document.querySelectorAll('[role="dialog"], form, .fixed')].find((node) =>
      [...node.querySelectorAll('h1,h2,h3')].some((heading) => {
        const text = heading.textContent?.trim() || '';
        return text === 'Add card' || text === 'Add teacher card';
      })
    )
    || null;
}

function findAddButton(dialog) {
  return [...(dialog?.querySelectorAll('button') || [])].find(
    (button) => button.textContent?.trim() === 'Add card'
  ) || null;
}

function addSendOption(dialog) {
  if (!dialog || dialog.querySelector('[data-iboard-add-card-send-option="true"]')) return;
  const addButton = findAddButton(dialog);
  const footer = addButton?.parentElement;
  if (!footer?.parentElement) return;

  const row = document.createElement('label');
  row.dataset.iboardAddCardSendOption = 'true';
  row.className = 'flex cursor-pointer items-center gap-2 border-t border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200';
  row.innerHTML = '<input type="checkbox" data-iboard-send-inbox="true" checked class="h-4 w-4 accent-indigo-600" /> <span>Send to student Inbox</span>';
  footer.parentElement.insertBefore(row, footer);
}

export default function AddTeacherCardSendController() {
  const [socket, setSocket] = useState(currentSocket);
  const [error, setError] = useState('');
  const postsRef = useRef([]);
  const pendingRef = useRef(null);

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
    const decorate = () => addSendOption(findAddCardDialog());
    decorate();
    const observer = new MutationObserver(() => requestAnimationFrame(decorate));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const onRoom = (payload) => {
      const nextPosts = Array.isArray(payload?.posts) ? payload.posts : [];
      const pending = pendingRef.current;
      postsRef.current = nextPosts;
      if (!pending) return;

      const candidates = nextPosts.filter((post) => !pending.previousIds.has(Number(post.id)));
      if (!candidates.length) return;

      pendingRef.current = null;
      const newest = [...candidates].sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!newest?.id) return;

      socket.emit('teacher:broadcast', { studentIds: [], postIds: [newest.id] }, (ack) => {
        if (ack?.ok) return;
        setError(ack?.error || 'Card added, but sending to Inbox failed.');
        setTimeout(() => setError(''), 3500);
      });
    };

    const onClick = (event) => {
      const dialog = findAddCardDialog();
      const addButton = findAddButton(dialog);
      if (!dialog || !addButton || !addButton.contains(event.target)) return;
      const checkbox = dialog.querySelector('input[data-iboard-send-inbox="true"]');
      if (!checkbox?.checked || addButton.disabled) {
        pendingRef.current = null;
        return;
      }
      pendingRef.current = {
        previousIds: new Set(postsRef.current.map((post) => Number(post.id))),
      };
      setTimeout(() => {
        if (pendingRef.current) pendingRef.current = null;
      }, 6000);
    };

    socket.on('room:state', onRoom);
    document.addEventListener('click', onClick, true);
    return () => {
      socket.off('room:state', onRoom);
      document.removeEventListener('click', onClick, true);
    };
  }, [socket]);

  if (!error) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-[110] -translate-x-1/2 rounded-full bg-red-600 px-4 py-2 text-sm font-black text-white shadow-lg">
      {error}
    </div>
  );
}
