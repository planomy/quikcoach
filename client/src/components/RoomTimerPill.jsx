import useEndsAtCountdown from '../hooks/useEndsAtCountdown.js';

function formatTimer(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function RoomTimerPill({ timer, onClick, className = '' }) {
  const running = !!timer?.active && !!timer?.running && !!timer?.endsAt;
  const liveSeconds = useEndsAtCountdown(timer?.endsAt, { enabled: running });
  if (!timer?.active) return null;

  const seconds = running && liveSeconds != null
    ? liveSeconds
    : Math.max(0, Number(timer?.remainingSeconds) || 0);
  const urgent = seconds <= 60;
  const finished = seconds === 0;
  const label = finished ? 'Time up' : formatTimer(seconds);
  const sharedClass = `iboard-room-timer inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] font-black tabular-nums transition ${
    finished
      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200'
      : urgent
        ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
        : 'border-slate-200 bg-white/80 text-slate-700 dark:border-slate-600 dark:bg-white/10 dark:text-slate-100'
  } ${className}`;

  const content = (
    <>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span>{label}</span>
      {!running && !finished ? <span className="font-sans text-[9px] font-bold uppercase tracking-wide opacity-70">Paused</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={sharedClass} aria-label={`Timer ${label}. Open timer settings.`}>
        {content}
      </button>
    );
  }

  return <div className={sharedClass} aria-label={`Timer ${label}`}>{content}</div>;
}
