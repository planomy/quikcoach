import { useEffect, useState } from 'react';

function currentSocket() {
  if (typeof window === 'undefined') return null;
  return window.location.pathname === '/teacher'
    ? window.__iboardTeacherSocket || null
    : window.__iboardStudentSocket || null;
}

function hideLegacyConnectionBanners() {
  if (typeof document === 'undefined') return;
  for (const node of document.querySelectorAll('[role="status"]')) {
    const text = node.textContent?.trim() || '';
    if (text === 'Connection lost — reconnecting…' || text === 'Back online') {
      node.style.display = 'none';
      node.setAttribute('aria-hidden', 'true');
      node.dataset.iboardLegacyConnectionBanner = 'true';
    }
  }
}

export default function ConnectionStatusController() {
  const [socket, setSocket] = useState(currentSocket);
  const [state, setState] = useState('hidden');

  useEffect(() => {
    const eventName = window.location.pathname === '/teacher'
      ? 'iboard:teacher-socket'
      : 'iboard:student-socket';
    const onSocket = (event) => setSocket(event.detail?.socket || currentSocket());
    window.addEventListener(eventName, onSocket);
    if (currentSocket()) setSocket(currentSocket());
    return () => window.removeEventListener(eventName, onSocket);
  }, []);

  useEffect(() => {
    hideLegacyConnectionBanners();
    const observer = new MutationObserver(hideLegacyConnectionBanners);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    let offlineTimer = null;
    let onlineTimer = null;
    let hadDisconnect = false;

    const clearTimers = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      if (onlineTimer) clearTimeout(onlineTimer);
      offlineTimer = null;
      onlineTimer = null;
    };

    const onDisconnect = () => {
      hadDisconnect = true;
      clearTimers();
      setState('reconnecting');
      offlineTimer = setTimeout(() => setState('offline'), 9000);
    };

    const onConnect = () => {
      clearTimers();
      if (!hadDisconnect) {
        setState('hidden');
        return;
      }
      hadDisconnect = false;
      setState('online');
      onlineTimer = setTimeout(() => setState('hidden'), 2200);
    };

    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    if (!socket.connected) onDisconnect();

    return () => {
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      clearTimers();
    };
  }, [socket]);

  if (state === 'hidden') return null;

  const config = state === 'online'
    ? {
        label: 'Back online',
        classes: 'border-emerald-200 bg-white text-emerald-700 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300',
        dot: 'bg-emerald-500',
      }
    : state === 'offline'
      ? {
          label: 'Still offline',
          classes: 'border-red-200 bg-white text-red-700 dark:border-red-900 dark:bg-slate-900 dark:text-red-300',
          dot: 'bg-red-500',
        }
      : {
          label: 'Reconnecting…',
          classes: 'border-amber-200 bg-white text-amber-700 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300',
          dot: 'bg-amber-400 animate-pulse',
        };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black shadow-lg backdrop-blur ${config.classes}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${config.dot}`} />
      <span>{config.label}</span>
    </div>
  );
}
