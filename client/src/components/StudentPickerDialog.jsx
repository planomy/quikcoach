import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import HintWrap from './HintWrap.jsx';

function rosterChoices(students) {
  return [...new Map((students || []).map((student) => [Number(student?.id), student])).values()]
    .filter((student) => Number(student?.id) > 0);
}

function PickerBody({ title, subtitle, students, initialIds, busy, error, onCancel, onConfirm }) {
  const choices = rosterChoices(students);
  const choiceIds = choices.map((student) => Number(student.id));
  const [pickedIds, setPickedIds] = useState(() => {
    const initial = new Set((initialIds || []).map(Number));
    return choiceIds.filter((id) => initial.has(id));
  });
  const validIds = pickedIds.filter((id) => choiceIds.includes(id));
  const allPicked = choiceIds.length > 0 && validIds.length === choiceIds.length;
  const titleId = useId();
  const panelRef = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    panelRef.current?.focus();
    // Capture on window so Escape closes only this picker, not the panel underneath.
    function onKey(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!busyRef.current) cancelRef.current?.();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  function toggle(id, checked) {
    setPickedIds((ids) => (checked ? [...ids.filter((item) => item !== id), id] : ids.filter((item) => item !== id)));
  }

  const count = validIds.length;
  const sendLabel = busy ? 'Sending…' : `Send to ${count} student${count === 1 ? '' : 's'}`;

  return createPortal(
    <div
      data-iboard-dialog
      data-iboard-sets-preview="true"
      className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-950/50 p-4 backdrop-blur-[1px] sm:items-center"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(36rem,calc(100dvh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="shrink-0 px-5 pb-3 pt-5">
          <h2 id={titleId} className="font-display text-lg font-black text-slate-950 dark:text-white">{title}</h2>
          {subtitle ? <p className="mt-1 truncate text-sm font-semibold text-slate-600 dark:text-slate-300" title={subtitle}>{subtitle}</p> : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-y border-slate-100 px-5 py-2 dark:border-slate-800">
          <div className="flex items-center gap-1.5">
            <HintWrap hint="Tick every student">
              <button
                type="button"
                disabled={busy || !choices.length || allPicked}
                onClick={() => setPickedIds(choiceIds)}
                className="rounded-md px-2 py-1 text-xs font-bold text-[#5a5fc3] hover:bg-[#ebeaf8] disabled:opacity-40 dark:text-indigo-300 dark:hover:bg-indigo-950/50"
              >
                Select all
              </button>
            </HintWrap>
            <HintWrap hint="Untick every student">
              <button
                type="button"
                disabled={busy || !count}
                onClick={() => setPickedIds([])}
                className="rounded-md px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Select none
              </button>
            </HintWrap>
          </div>
          <span role="status" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {count} of {choices.length} selected
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {choices.length ? (
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
              {choices.map((student) => {
                const id = Number(student.id);
                const checked = validIds.includes(id);
                return (
                  <label
                    key={id}
                    className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-800 hover:bg-[#ebeaf8] dark:text-slate-100 dark:hover:bg-slate-800 ${checked ? 'bg-[#ebeaf8]/70 dark:bg-indigo-950/40' : ''}`}
                  >
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={checked}
                      onChange={(event) => toggle(id, event.target.checked)}
                      className="h-4 w-4 shrink-0 accent-[#5a5fc3]"
                    />
                    <span title={student.name} className="min-w-0 flex-1 truncate">{student.name}</span>
                    {student.connected === false && <span className="shrink-0 text-[10px] font-normal text-slate-400">Offline</span>}
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="px-2 py-4 text-sm text-slate-500 dark:text-slate-400">No students in this room yet.</p>
          )}
        </div>

        {error ? <p role="alert" className="shrink-0 px-5 pb-2 text-xs font-semibold text-red-600 dark:text-red-300">{error}</p> : null}

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-950 sm:flex-row sm:justify-end">
          <HintWrap hint="Close without sending" className="justify-center">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </HintWrap>
          <HintWrap hint={count ? 'Send it to the ticked students’ inboxes' : 'Tick at least one student first'} className="justify-center">
            <button
              type="button"
              disabled={busy || !count}
              onClick={() => onConfirm?.(validIds)}
              className="w-full rounded-xl bg-[#5a5fc3] px-5 py-2.5 text-sm font-black text-white hover:bg-[#4b50b0] disabled:opacity-40"
            >
              {sendLabel}
            </button>
          </HintWrap>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Centred "choose which students get it" picker. State resets each time it opens. */
export default function StudentPickerDialog({
  open,
  title = 'Select students',
  subtitle = '',
  students = [],
  initialIds = [],
  busy = false,
  error = '',
  onCancel,
  onConfirm,
}) {
  if (!open || typeof document === 'undefined') return null;
  return (
    <PickerBody
      title={title}
      subtitle={subtitle}
      students={students}
      initialIds={initialIds}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
