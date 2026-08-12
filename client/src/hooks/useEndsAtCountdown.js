import { useEffect, useState } from 'react';

/**
 * Smooth wall-clock countdown from an absolute endsAt ISO timestamp.
 * Uses a Web Worker so floating/background Pulse panels are less likely to skip
 * seconds when the browser throttles the main tab's timers.
 *
 * clockOffsetRef: optional ref whose .current is (serverNow - Date.now()).
 */
function createCountdownWorker() {
  const source = `
    let timer = 0;
    let deadline = 0;
    function left() {
      return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    }
    function tick() {
      const value = left();
      postMessage(value);
      if (value <= 0 && timer) {
        clearInterval(timer);
        timer = 0;
      }
    }
    onmessage = (event) => {
      if (timer) clearInterval(timer);
      timer = 0;
      deadline = Number(event.data) || 0;
      if (!deadline) {
        postMessage(null);
        return;
      }
      tick();
      timer = setInterval(tick, 200);
    };
  `;
  const blob = new Blob([source], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  return { worker: new Worker(url), url };
}

function secondsRemaining(endMs, clockOffsetMs) {
  return Math.max(0, Math.ceil((endMs - (Date.now() + clockOffsetMs)) / 1000));
}

export default function useEndsAtCountdown(endsAt, { enabled = true, clockOffsetRef = null } = {}) {
  const [secondsLeft, setSecondsLeft] = useState(null);

  useEffect(() => {
    if (!enabled || !endsAt) {
      setSecondsLeft(null);
      return undefined;
    }
    const endMs = Date.parse(endsAt);
    if (!Number.isFinite(endMs)) {
      setSecondsLeft(null);
      return undefined;
    }

    let cancelled = false;
    let timeoutId = 0;
    let worker = null;
    let workerUrl = '';

    const offset = () => Number(clockOffsetRef?.current) || 0;
    const localDeadline = () => endMs - offset();

    const publish = (value) => {
      if (!cancelled) setSecondsLeft(value);
    };

    const scheduleMainThread = () => {
      if (cancelled) return;
      const left = secondsRemaining(endMs, offset());
      publish(left);
      if (left <= 0) return;
      const msUntilFlip = Math.max(40, localDeadline() - (left - 1) * 1000 - Date.now());
      timeoutId = window.setTimeout(scheduleMainThread, msUntilFlip);
    };

    const wake = () => {
      window.clearTimeout(timeoutId);
      if (worker) {
        worker.postMessage(localDeadline());
      } else {
        scheduleMainThread();
      }
    };

    try {
      const created = createCountdownWorker();
      worker = created.worker;
      workerUrl = created.url;
      worker.onmessage = (event) => publish(event.data);
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        scheduleMainThread();
      };
      worker.postMessage(localDeadline());
    } catch {
      worker = null;
      scheduleMainThread();
    }

    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pageshow', wake);
      if (worker) worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };
  }, [endsAt, enabled, clockOffsetRef]);

  return secondsLeft;
}
