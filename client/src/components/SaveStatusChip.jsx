/** Compact autosave chip for headers — Saving… / Saved / Save failed. */
export default function SaveStatusChip({ status }) {
  if (!status || status === 'idle') return null;
  const label = status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : 'Saved';
  const tone =
    status === 'saving'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
      : status === 'error'
        ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black leading-none ${tone}`}
    >
      {status === 'saving' && (
        <span aria-hidden="true" className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
      )}
      {label}
    </span>
  );
}
