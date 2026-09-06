import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges } from '../lib/viewport.js';

function HandIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 11.5V5.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M14 11V7.5a1.5 1.5 0 0 1 3 0V14" />
      <path d="M17 13.5V12a1.5 1.5 0 0 1 3 0v3.5a6.5 6.5 0 0 1-6.5 6.5h-1.2A6.3 6.3 0 0 1 6 15.7V13a2 2 0 0 1 2-2h0" />
      <path d="M5 12v1.5a1.5 1.5 0 0 0 3 0V12" />
    </svg>
  );
}

const POPOVER_WIDTH = 280;
const POPOVER_EST_HEIGHT = 168;

/**
 * Compact hand control for the writing toolbar — popover anchors next to the button.
 */
export default function StudentHandRaise({ socket, compact = false }) {
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [box, setBox] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [questions, setQuestions] = useState([]);

  useEffect(() => {
    if (!socket) return undefined;
    const onState = (payload) => setQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    socket.on('qna:student', onState);
    socket.emit('student:qna-sync', {});
    return () => socket.off('qna:student', onState);
  }, [socket]);

  const handUp = useMemo(
    () => questions.some((question) => question.mine && question.status === 'pending'),
    [questions]
  );

  useLayoutEffect(() => {
    if (!open || !anchorRect) {
      setBox(null);
      return undefined;
    }
    const place = () => {
      const height = panelRef.current?.offsetHeight || POPOVER_EST_HEIGHT;
      const width = panelRef.current?.offsetWidth || POPOVER_WIDTH;
      setBox(
        placementNearAnchor({
          anchor: anchorRect,
          width,
          height,
          gap: 6,
          prefer: 'below-left',
        })
      );
    };
    place();
    return subscribeViewportChanges(place);
  }, [open, anchorRect, error]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }
    function onPointer(event) {
      if (panelRef.current?.contains(event.target) || btnRef.current?.contains(event.target)) return;
      close();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, sending]);

  function close() {
    if (sending) return;
    setOpen(false);
    setError('');
  }

  function openPopover(event) {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget || btnRef.current)?.getBoundingClientRect();
    if (!rect) return;
    setAnchorRect(rect);
    setError('');
    setOpen(true);
  }

  function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || !socket) return;
    setSending(true);
    setError('');
    socket.emit('student:qna-submit', { text, anonymous: false }, (ack) => {
      setSending(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not send.');
        return;
      }
      setDraft('');
      setOpen(false);
    });
  }

  const btnClass = compact
    ? `flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 shadow-sm transition ${
        handUp
          ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
      }`
    : `grid h-10 w-10 shrink-0 place-items-center rounded-xl border shadow-sm transition ${
        handUp
          ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
          : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
      }`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
        className={btnClass}
        aria-label={handUp ? 'Hand up — ask another question' : 'Raise hand to ask the teacher'}
        aria-expanded={open}
        aria-pressed={handUp}
      >
        <HandIcon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <form
              ref={panelRef}
              onSubmit={submit}
              role="dialog"
              aria-modal="true"
              aria-label="Ask your teacher"
              className="fixed z-[120] w-[min(17.5rem,calc(100vw-1.25rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900"
              style={{
                top: box?.top ?? -9999,
                left: box?.left ?? -9999,
                visibility: box ? 'visible' : 'hidden',
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="p-2.5">
                <textarea
                  ref={inputRef}
                  value={draft}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => setDraft(event.target.value.slice(0, 500))}
                  placeholder="What do you need?"
                  className="w-full resize-none rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none ring-rose-400 focus:border-rose-400 focus:ring-1 dark:border-rose-900 dark:bg-slate-950 dark:text-white"
                />
                {error ? <p className="mt-1 text-[11px] font-semibold text-red-600">{error}</p> : null}
                <div className="mt-1.5 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={close}
                    className="rounded-lg px-2.5 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-40"
                  >
                    {sending ? '…' : 'Send'}
                  </button>
                </div>
              </div>
            </form>,
            document.body
          )
        : null}
    </>
  );
}
