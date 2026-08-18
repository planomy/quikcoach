import { useEffect, useMemo, useRef, useState } from 'react';
import { plainTextToRichHtml, richHtmlToPlainText, sanitizeRichHtml } from '../lib/richText.js';

function countWords(value) {
  const text = String(value || '').trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function insertPlainTextAtSelection(text) {
  if (document.execCommand?.('insertText', false, text)) return;
  const selection = window.getSelection?.();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function ToolbarButton({ label, title, onClick, disabled = false, className = '' }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/60 ${className}`}
    >
      {label}
    </button>
  );
}

export default function RichTextEditor({
  text = '',
  html = '',
  onChange,
  onPaste,
  disabled = false,
  maxWords = 0,
  placeholder = 'Write here…',
}) {
  const editorRef = useRef(null);
  const lastAcceptedHtmlRef = useRef('');
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(!String(text || '').trim());

  const incomingHtml = useMemo(() => {
    const safe = sanitizeRichHtml(html);
    return safe || plainTextToRichHtml(text);
  }, [html, text]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    if (editor.innerHTML !== incomingHtml) editor.innerHTML = incomingHtml;
    lastAcceptedHtmlRef.current = incomingHtml;
    setEmpty(!richHtmlToPlainText(incomingHtml).trim());
  }, [incomingHtml]);

  function commitFromDom({ normaliseDom = false } = {}) {
    const editor = editorRef.current;
    if (!editor) return;

    const safeHtml = sanitizeRichHtml(editor.innerHTML);
    const plainText = richHtmlToPlainText(safeHtml);

    if (maxWords > 0 && countWords(plainText) > maxWords) {
      editor.innerHTML = lastAcceptedHtmlRef.current || '';
      setEmpty(!richHtmlToPlainText(editor.innerHTML).trim());
      return;
    }

    lastAcceptedHtmlRef.current = safeHtml;
    if (normaliseDom && editor.innerHTML !== safeHtml) editor.innerHTML = safeHtml;
    setEmpty(!plainText.trim());
    onChange?.({ text: plainText, html: safeHtml });
  }

  function runCommand(command, value = null) {
    if (disabled) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      /* unsupported command */
    }
    commitFromDom();
  }

  function highlightSelection() {
    if (disabled) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    let worked = false;
    try {
      worked = document.execCommand('hiliteColor', false, '#fde68a');
    } catch {
      worked = false;
    }
    if (!worked) {
      try {
        document.execCommand('backColor', false, '#fde68a');
      } catch {
        /* unsupported */
      }
    }
    commitFromDom({ normaliseDom: true });
  }

  function handlePaste(event) {
    onPaste?.(event);
    if (event.defaultPrevented || disabled) return;
    event.preventDefault();
    const plain = event.clipboardData?.getData('text/plain') || '';
    insertPlainTextAtSelection(plain);
    commitFromDom();
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card ring-indigo-500 focus-within:border-indigo-500 focus-within:ring-2 dark:border-slate-600 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/70">
        <ToolbarButton disabled={disabled} label="B" title="Bold" onClick={() => runCommand('bold')} />
        <ToolbarButton disabled={disabled} label={<span className="italic">I</span>} title="Italic" onClick={() => runCommand('italic')} />
        <ToolbarButton disabled={disabled} label={<span className="underline">U</span>} title="Underline" onClick={() => runCommand('underline')} />
        <ToolbarButton
          disabled={disabled}
          label={<span className="rounded bg-yellow-200 px-1.5 py-0.5 text-xs text-slate-900">H</span>}
          title="Highlight"
          onClick={highlightSelection}
        />
        <ToolbarButton disabled={disabled} label="•" title="Bullet list" onClick={() => runCommand('insertUnorderedList')} />
        <span className="mx-0.5 h-5 w-px bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
        <ToolbarButton disabled={disabled} label="↶" title="Undo" onClick={() => runCommand('undo')} />
        <ToolbarButton disabled={disabled} label="↷" title="Redo" onClick={() => runCommand('redo')} />
        <span className="ml-auto text-[11px] font-medium text-slate-400">Select text, then format</span>
      </div>
      <div className="relative">
        {empty && !focused && (
          <div className="pointer-events-none absolute left-4 top-4 text-sm text-slate-400 dark:text-slate-500">
            {disabled ? 'Class is frozen by your teacher.' : placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-readonly={disabled}
          onInput={() => commitFromDom()}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitFromDom({ normaliseDom: true });
          }}
          className={`min-h-[280px] whitespace-pre-wrap p-4 text-sm leading-relaxed text-slate-800 outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_mark]:rounded-sm [&_mark]:bg-yellow-200 [&_mark]:px-0.5 [&_mark]:text-slate-900 dark:text-slate-100 ${
            disabled ? 'cursor-not-allowed bg-slate-100 dark:bg-slate-800' : ''
          }`}
        />
      </div>
    </div>
  );
}
