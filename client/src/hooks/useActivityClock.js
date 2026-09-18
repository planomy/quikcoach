import { useEffect, useState } from 'react';

/** Wall-clock tick so activity dots age between student:live events. */
export default function useActivityClock(intervalMs = 5000) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}
