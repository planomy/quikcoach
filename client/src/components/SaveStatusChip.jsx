import HintWrap from './HintWrap.jsx';

/** Compact autosave chip for headers — Saving… / Saved / Save failed. */
export default function SaveStatusChip({ status, plain = false }) {
  if (!status || status === 'idle') return null;
  const label = status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : 'Saved';
  const hint =
    status === 'error'
      ? 'The latest change could not be saved to the server'
      : 'Live lesson changes are saved to the server';
  if (plain) {
    const tone =
      status === 'saving'
        ? 'text-emerald-700 dark:text-emerald-300'
        : status === 'error'
          ? 'text-red-700 dark:text-red-300'
          : 'iboard-header-status-saved text-emerald-700 dark:text-emerald-300';
    return (
      <HintWrap hint={hint} prefer="below">
        <span
          role="status"
          aria-live="polite"
          title=""
          className={`inline-flex items-center text-[12px] font-semibold leading-none ${tone}`}
        >
          {status === 'saving' && (
            <span aria-hidden="true" className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          )}
          {label}
        </span>
      </HintWrap>
    );
  }
  const tone =
    status === 'saving'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
      : status === 'error'
        ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  return (
    <HintWrap hint={hint} prefer="below">
      <span
        role="status"
        aria-live="polite"
        title=""
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black leading-none shadow-sm ${tone}`}
      >
        {status === 'saving' && (
          <span aria-hidden="true" className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        )}
        {label}
      </span>
    </HintWrap>
  );
}
