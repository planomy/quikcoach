import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** @typedef {{ mode?: 'confirm'|'prompt', title: string, message?: string, confirmLabel?: string, cancelLabel?: string, tone?: 'danger'|'brand', defaultValue?: string, inputLabel?: string, placeholder?: string }} DialogOptions */

let openDialog = null;

/**
 * Promise-based centred confirm. Resolves true/false.
 * @param {DialogOptions} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options) {
  if (typeof openDialog !== 'function') {
    return Promise.resolve(
      window.confirm([options?.title, options?.message].filter(Boolean).join('\n\n'))
    );
  }
  return openDialog({
    mode: 'confirm',
    tone: 'danger',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    ...options,
  }).then((result) => !!result);
}

/**
 * Promise-based centred prompt. Resolves string or null (cancel).
 * @param {DialogOptions} options
 * @returns {Promise<string|null>}
 */
export function promptDialog(options) {
  if (typeof openDialog !== 'function') {
    const next = window.prompt(options?.title || options?.message || '', options?.defaultValue || '');
    return Promise.resolve(next);
  }
  return openDialog({
    mode: 'prompt',
    tone: 'brand',
    confirmLabel: 'Save',
    cancelLabel: 'Cancel',
    ...options,
  }).then((result) => (typeof result === 'string' ? result : null));
}

/**
 * Mount once near the app root so confirmDialog / promptDialog work everywhere.
 */
export default function ConfirmDialogHost() {
  const [request, setRequest] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const inputId = useId();

  useEffect(() => {
    openDialog = (options) =>
      new Promise((resolve) => {
        setInputValue(String(options.defaultValue || ''));
        setRequest({ ...options, resolve });
      });
    return () => {
      if (openDialog) openDialog = null;
    };
  }, []);

  useEffect(() => {
    if (!request) return undefined;
    const focusTimer = window.setTimeout(() => {
      if (request.mode === 'prompt') inputRef.current?.focus();
    }, 20);
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close uses latest request via setState
  }, [request]);

  function close(result) {
    setRequest((current) => {
      current?.resolve?.(result);
      return null;
    });
  }

  if (!request || typeof document === 'undefined') return null;

  const isPrompt = request.mode === 'prompt';
  const tone = request.tone === 'brand' ? 'brand' : 'danger';
  const confirmClass =
    tone === 'brand'
      ? 'rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700'
      : 'rounded-xl bg-red-600 px-5 py-2.5 text-sm font-black text-white hover:bg-red-700';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-950/50 p-4 backdrop-blur-[1px] sm:items-center">
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.message ? descId : undefined}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-5">
          <h2 id={titleId} className="font-display text-lg font-black text-slate-950 dark:text-white">
            {request.title}
          </h2>
          {request.message ? (
            <p id={descId} className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
              {request.message}
            </p>
          ) : null}
          {isPrompt ? (
            <div className="mt-4">
              {request.inputLabel ? (
                <label htmlFor={inputId} className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  {request.inputLabel}
                </label>
              ) : null}
              <textarea
                ref={inputRef}
                id={inputId}
                value={inputValue}
                rows={4}
                maxLength={500}
                onChange={(event) => setInputValue(event.target.value.slice(0, 500))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    close(inputValue);
                  }
                }}
                placeholder={request.placeholder || ''}
                className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-950 sm:flex-row sm:justify-end">
          <button
            type="button"
            autoFocus={!isPrompt}
            onClick={() => close(isPrompt ? null : false)}
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {request.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => close(isPrompt ? inputValue : true)}
            className={confirmClass}
          >
            {request.confirmLabel || (isPrompt ? 'Save' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
