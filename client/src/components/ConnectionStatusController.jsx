import { useEffect, useState } from 'react';

/** How long a blip can last before we treat it as a real connection problem. */
const PROBLEM_AFTER_MS = 45000;

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

function ReconnectingDots() {
  return (
    <span className="iboard-conn-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
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
    let frame = 0;
    const scheduleHide = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        hideLegacyConnectionBanners();
      });
    };
    const observer = new MutationObserver(scheduleHide);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    let problemTimer = null;
    let onlineTimer = null;
    let hadDisconnect = false;

    const clearTimers = () => {
      if (problemTimer) clearTimeout(problemTimer);
      if (onlineTimer) clearTimeout(onlineTimer);
      problemTimer = null;
      onlineTimer = null;
    };

    const onDisconnect = () => {
      hadDisconnect = true;
      clearTimers();
      setState('reconnecting');
      // Only go red after a sustained outage — brief blips stay calm.
      problemTimer = setTimeout(() => setState('failed'), PROBLEM_AFTER_MS);
    };

    const onReconnectFailed = () => {
      hadDisconnect = true;
      clearTimers();
      setState('failed');
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
    socket.io?.on?.('reconnect_failed', onReconnectFailed);
    if (!socket.connected) onDisconnect();

    return () => {
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      socket.io?.off?.('reconnect_failed', onReconnectFailed);
      clearTimers();
    };
  }, [socket]);

  if (state === 'hidden') return null;

  if (state === 'online') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="iboard-conn-pill fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 items-center gap-2 border-[#cfcce8] bg-white text-[#5a5fc3] dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300"
      >
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#5a5fc3]" />
        <span>Back online</span>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div
        role="status"
        aria-live="assertive"
        className="iboard-conn-pill fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 items-center gap-2 border-red-200 bg-white text-red-700 dark:border-red-900 dark:bg-slate-900 dark:text-red-300"
      >
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-500" />
        <span>Can&apos;t reconnect — check your network</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="iboard-conn-pill fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 items-center gap-2 border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
    >
      <span>Reconnecting</span>
      <ReconnectingDots />
    </div>
  );
}
