import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import HintWrap from './HintWrap.jsx';
import { placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges } from '../lib/viewport.js';
import {
  THINKING_CATEGORIES,
  THINKING_MAX_SELECT,
  promptsByCategory,
  sendThinkingToInbox,
} from '../lib/thinkingPrompts.js';

const POPOVER_WIDTH = 420;
const POPOVER_EST_HEIGHT = 340;

function LightbulbIcon({ className = 'h-3.5 w-3.5' }) {
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
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.5 1 2.4V18h6v-1.6c0-.9.4-1.8 1-2.4A7 7 0 0 0 12 2z" />
    </svg>
  );
}

/**
 * Floating Thinking popover — 3×2 categories, multi-pick ≤3, one Send.
 */
export function ThinkingPopover({
  open,
  anchorRect,
  onClose,
  studentIds = [],
  targetLabel = '',
  subjectAssist = 'general',
  socket = null,
  onSent,
}) {
  const panelRef = useRef(null);
  const [box, setBox] = useState(null);
  const [selected, setSelected] = useState(() => new Map());
  const [customDraft, setCustomDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const grouped = useMemo(() => promptsByCategory(subjectAssist), [subjectAssist]);
  const selectedList = useMemo(() => [...selected.values()], [selected]);
  const recipientCount = useMemo(
    () => [...new Set((studentIds || []).map((id) => Number(id)).filter((id) => id > 0))].length,
    [studentIds]
  );

  useEffect(() => {
    if (!open) return undefined;
    setSelected(new Map());
    setCustomDraft('');
    setError('');
    setStatus('');
    setSending(false);
  }, [open, anchorRect?.top, anchorRect?.left]);

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
          gap: 8,
          prefer: 'below-left',
        })
      );
    };
    place();
    return subscribeViewportChanges(place);
  }, [open, anchorRect, selectedList.length, error, status]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    }
    function onPointer(event) {
      if (panelRef.current?.contains(event.target)) return;
      onClose?.();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);

  function togglePrompt(id, text) {
    setError('');
    setStatus('');
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= THINKING_MAX_SELECT) {
        setError(`Pick up to ${THINKING_MAX_SELECT} prompts.`);
        return prev;
      }
      next.set(id, text);
      return next;
    });
  }

  function addCustom() {
    const text = customDraft.trim();
    if (!text) return;
    setError('');
    setStatus('');
    setSelected((prev) => {
      if (prev.size >= THINKING_MAX_SELECT) {
        setError(`Pick up to ${THINKING_MAX_SELECT} prompts.`);
        return prev;
      }
      const next = new Map(prev);
      next.set(`custom-${Date.now()}`, text);
      return next;
    });
    setCustomDraft('');
  }

  function handleSend() {
    if (sending || !selectedList.length) return;
    if (!recipientCount) {
      setError('No students to send to.');
      return;
    }
    const sock = socket || (typeof window !== 'undefined' ? window.__iboardTeacherSocket : null);
    setSending(true);
    setError('');
    sendThinkingToInbox(sock, { studentIds, texts: selectedList }, (ack) => {
      setSending(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not send.');
        return;
      }
      const n = selectedList.length;
      const who =
        recipientCount === 1
          ? targetLabel || 'student'
          : `${recipientCount} students`;
      setStatus(`Sent ${n} · ${who}`);
      onSent?.({ count: n, recipients: recipientCount });
      window.setTimeout(() => onClose?.(), 700);
    });
  }

  if (!open || !anchorRect || typeof document === 'undefined') return null;

  const sendLabel =
    recipientCount > 1
      ? `Send to ${recipientCount}${selectedList.length ? ` (${selectedList.length})` : ''}`
      : selectedList.length > 1
        ? `Send (${selectedList.length})`
        : 'Send';

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Thinking prompts"
      className="fixed z-[120] w-[min(26rem,calc(100vw-1.25rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-600 dark:bg-slate-900"
      style={{
        top: box?.top ?? -9999,
        left: box?.left ?? -9999,
        visibility: box ? 'visible' : 'hidden',
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
            Thinking
          </p>
          <p className="mt-0.5 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
            {recipientCount > 1
              ? `Push ${recipientCount} students · pick up to ${THINKING_MAX_SELECT}`
              : `Push ${targetLabel || 'this student'} · pick up to ${THINKING_MAX_SELECT}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="Close thinking prompts"
        >
          ×
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {THINKING_CATEGORIES.map((category) => (
          <div
            key={category.id}
            className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/80 p-1.5 dark:border-slate-700 dark:bg-slate-950/50"
          >
            <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {category.label}
            </p>
            <div className="space-y-0.5">
              {(grouped[category.id] || []).map((prompt) => {
                const on = selected.has(prompt.id);
                return (
                  <button
                    key={prompt.id}
                    type="button"
                    title={prompt.text}
                    onClick={() => togglePrompt(prompt.id, prompt.text)}
                    className={`w-full rounded-lg px-1.5 py-1 text-left text-[11px] font-semibold leading-snug transition ${
                      on
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="line-clamp-2">{prompt.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex gap-1.5">
        <input
          type="text"
          value={customDraft}
          onChange={(event) => setCustomDraft(event.target.value.slice(0, 180))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addCustom();
            }
          }}
          placeholder="Custom prompt…"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-1 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customDraft.trim()}
          className="shrink-0 rounded-xl border border-slate-200 px-2.5 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Add
        </button>
      </div>

      {(error || status) && (
        <p
          className={`mt-2 text-[11px] font-semibold ${
            error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {error || status}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-slate-400">
          {selectedList.length}/{THINKING_MAX_SELECT} selected
        </p>
        <button
          type="button"
          disabled={!selectedList.length || sending || !recipientCount}
          onClick={handleSend}
          className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
        >
          {sending ? 'Sending…' : sendLabel}
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * Lightbulb control that opens ThinkingPopover anchored to itself.
 */
export default function ThinkingTrigger({
  studentIds = [],
  targetLabel = '',
  subjectAssist = 'general',
  socket = null,
  size = 'sm',
  hint = 'Thinking',
  className = '',
  onSent,
}) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);

  function openPopover(event) {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget || btnRef.current)?.getBoundingClientRect();
    if (!rect) return;
    setAnchorRect(rect);
    setOpen(true);
  }

  const iconClass = size === 'md' ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5';
  const btnClass =
    size === 'md'
      ? `grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-indigo-200 bg-white text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-indigo-950 ${className}`
      : `grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300 ${className}`;

  return (
    <>
      <HintWrap hint={hint}>
        <button
          ref={btnRef}
          type="button"
          onClick={openPopover}
          className={btnClass}
          aria-label={
            targetLabel
              ? `Thinking prompts for ${targetLabel}`
              : studentIds.length > 1
                ? 'Thinking prompts for the class'
                : 'Thinking prompts'
          }
          aria-expanded={open}
        >
          <LightbulbIcon className={iconClass} />
        </button>
      </HintWrap>
      <ThinkingPopover
        open={open}
        anchorRect={anchorRect}
        onClose={() => setOpen(false)}
        studentIds={studentIds}
        targetLabel={targetLabel}
        subjectAssist={subjectAssist}
        socket={socket}
        onSent={onSent}
      />
    </>
  );
}

export { LightbulbIcon };
