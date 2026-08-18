from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(rel, old, new):
    path = ROOT / rel
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"Could not find expected block in {rel}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one match in {rel}, found {text.count(old)}")
    path.write_text(text.replace(old, new, 1))

def write_file(rel, content):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)

write_file("client/src/lib/richText.js", r"""const BLOCK_TAGS = new Set(['div', 'p', 'li']);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hasHighlightStyle(el) {
  if (!el?.style) return false;
  const bg = String(el.style.backgroundColor || '').trim().toLowerCase();
  return !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
}

function sanitiseNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return escapeHtml(node.nodeValue || '');
  if (node.nodeType !== 1) return '';

  const rawTag = String(node.tagName || '').toLowerCase();
  const children = Array.from(node.childNodes || []).map(sanitiseNode).join('');

  if (rawTag === 'br') return '<br>';
  if (rawTag === 'span' && hasHighlightStyle(node)) return `<mark>${children}</mark>`;

  const tag =
    rawTag === 'b'
      ? 'strong'
      : rawTag === 'i'
        ? 'em'
        : rawTag;

  if (!['div', 'p', 'strong', 'em', 'u', 'mark', 'ul', 'ol', 'li'].includes(tag)) {
    return children;
  }
  return `<${tag}>${children}</${tag}>`;
}

export function sanitizeRichHtml(rawHtml) {
  const html = String(rawHtml || '');
  if (!html.trim() || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.childNodes || []).map(sanitiseNode).join('');
}

function plainFromNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';

  const tag = String(node.tagName || '').toLowerCase();
  if (tag === 'br') return '\n';

  const body = Array.from(node.childNodes || []).map(plainFromNode).join('');
  return BLOCK_TAGS.has(tag) ? `${body}\n` : body;
}

export function richHtmlToPlainText(rawHtml) {
  const html = sanitizeRichHtml(rawHtml);
  if (!html || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.childNodes || [])
    .map(plainFromNode)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/g, '');
}

export function plainTextToRichHtml(rawText) {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n');
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => `<div>${line ? escapeHtml(line) : '<br>'}</div>`)
    .join('');
}
""")

write_file("client/src/components/RichTextDisplay.jsx", r"""import { useMemo } from 'react';
import { richHtmlToPlainText, sanitizeRichHtml } from '../lib/richText.js';

export default function RichTextDisplay({ html, text = '', className = '' }) {
  const safeHtml = useMemo(() => sanitizeRichHtml(html), [html]);
  const richPlain = safeHtml ? richHtmlToPlainText(safeHtml) : '';
  const expectedPlain = String(text || '').replace(/\r\n?/g, '\n');
  const hasRichText = safeHtml && richPlain.trim() && richPlain === expectedPlain;

  if (!hasRichText) {
    return <div className={`whitespace-pre-wrap break-words ${className}`}>{text}</div>;
  }

  return (
    <div
      className={`break-words [&_div]:min-h-[1em] [&_p]:min-h-[1em] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_mark]:rounded-sm [&_mark]:bg-yellow-200 [&_mark]:px-0.5 [&_mark]:text-inherit ${className}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
""")

write_file("client/src/components/RichTextEditor.jsx", r"""import { useEffect, useMemo, useRef, useState } from 'react';
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

function ToolbarButton({ label, title, onClick, className = '' }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
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
    commitFromDom();
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
        <ToolbarButton label="B" title="Bold" onClick={() => runCommand('bold')} />
        <ToolbarButton label={<span className="italic">I</span>} title="Italic" onClick={() => runCommand('italic')} />
        <ToolbarButton label={<span className="underline">U</span>} title="Underline" onClick={() => runCommand('underline')} />
        <ToolbarButton
          label={<span className="rounded bg-yellow-200 px-1.5 py-0.5 text-xs text-slate-900">H</span>}
          title="Highlight"
          onClick={highlightSelection}
        />
        <ToolbarButton label="•" title="Bullet list" onClick={() => runCommand('insertUnorderedList')} />
        <span className="mx-0.5 h-5 w-px bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
        <ToolbarButton label="↶" title="Undo" onClick={() => runCommand('undo')} />
        <ToolbarButton label="↷" title="Redo" onClick={() => runCommand('redo')} />
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
          className={`min-h-[280px] p-4 text-sm leading-relaxed text-slate-800 outline-none dark:text-slate-100 ${
            disabled ? 'cursor-not-allowed bg-slate-100 dark:bg-slate-800' : ''
          }`}
        />
      </div>
    </div>
  );
}
""")

replace_once(
    "client/src/pages/StudentView.jsx",
    """import LiveResponseStudent from '../components/LiveResponseStudent.jsx';\n""",
    """import LiveResponseStudent from '../components/LiveResponseStudent.jsx';\nimport RichTextEditor from '../components/RichTextEditor.jsx';\nimport RichTextDisplay from '../components/RichTextDisplay.jsx';\nimport { plainTextToRichHtml } from '../lib/richText.js';\n"""
)

replace_once(
    "client/src/pages/StudentView.jsx",
    """  const [draft, setDraft] = useState('');\n""",
    """  const [draft, setDraft] = useState('');\n  const [draftHtml, setDraftHtml] = useState('');\n"""
)

replace_once(
    "client/src/pages/StudentView.jsx",
    """  const pendingRef = useRef('');\n""",
    """  const pendingRef = useRef({ text: '', richTextHtml: '' });\n"""
)

replace_once(
    "client/src/pages/StudentView.jsx",
    """      const typing = document.activeElement?.tagName === 'TEXTAREA';\n      const r = payload.room;\n      const lim =\n        r?.enforce_word_count && (r?.word_target ?? 0) > 0 ? Number(r.word_target) : 0;\n      const raw = me.text || '';\n      if (!typing) setDraft(lim > 0 ? truncateToWordLimit(raw, lim) : raw);\n""",
    """      const typing = !!document.activeElement?.isContentEditable;\n      const r = payload.room;\n      const lim =\n        r?.enforce_word_count && (r?.word_target ?? 0) > 0 ? Number(r.word_target) : 0;\n      const raw = me.text || '';\n      if (!typing) {\n        const next = lim > 0 ? truncateToWordLimit(raw, lim) : raw;\n        setDraft(next);\n        setDraftHtml(\n          next === raw && me.rich_text_html ? me.rich_text_html : plainTextToRichHtml(next)\n        );\n      }\n"""
)

replace_once(
    "client/src/pages/StudentView.jsx",
    """  useEffect(() => {\n    pendingRef.current = draft;\n  }, [draft]);\n\n  useEffect(() => {\n    if (!joined || !student) return;\n    const t = setInterval(() => {\n      socket.emit('student:text', { text: pendingRef.current }, () => {});\n    }, 2000);\n    return () => clearInterval(t);\n  }, [joined, student, socket]);\n""",
    """  useEffect(() => {\n    pendingRef.current = { text: draft, richTextHtml: draftHtml };\n  }, [draft, draftHtml]);\n\n  useEffect(() => {\n    if (!joined || !student) return;\n    const t = setInterval(() => {\n      socket.emit('student:text', pendingRef.current, () => {});\n    }, 2000);\n    return () => clearInterval(t);\n  }, [joined, student, socket]);\n"""
)

replace_once(
    "client/src/pages/StudentView.jsx",
    """    setDraft((d) => truncateToWordLimit(d, wt));\n""",
    """    setDraft((d) => {\n      const next = truncateToWordLimit(d, wt);\n      if (next !== d) setDraftHtml(plainTextToRichHtml(next));\n      return next;\n    });\n"""
)

old_hydrate = """        const raw = ack.student.text || '';\n        setDraft(lim > 0 ? truncateToWordLimit(raw, lim) : raw);\n"""
new_hydrate = """        const raw = ack.student.text || '';\n        const next = lim > 0 ? truncateToWordLimit(raw, lim) : raw;\n        setDraft(next);\n        setDraftHtml(\n          next === raw && ack.student?.rich_text_html\n            ? ack.student.rich_text_html\n            : plainTextToRichHtml(next)\n        );\n"""
path = ROOT / "client/src/pages/StudentView.jsx"
text = path.read_text()
if text.count(old_hydrate) != 2:
    raise SystemExit(f"Expected two hydration blocks in StudentView, found {text.count(old_hydrate)}")
path.write_text(text.replace(old_hydrate, new_hydrate))

replace_once(
    "client/src/pages/StudentView.jsx",
    """                  {ex.text?.trim() ? (\n                    <p className=\"mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300 scrollbar-thin\">\n                      {ex.text}\n                    </p>\n                  ) : !ex.image_url ? (\n""",
    """                  {ex.text?.trim() ? (\n                    <RichTextDisplay\n                      html={ex.rich_text_html}\n                      text={ex.text}\n                      className=\"mt-2 max-h-48 overflow-auto text-slate-700 dark:text-slate-300 scrollbar-thin\"\n                    />\n                  ) : !ex.image_url ? (\n"""
)

replace_once(
    "client/src/pages/StudentView.jsx",
    """        <textarea\n          value={draft}\n          onChange={(e) => {\n            let v = e.target.value;\n            if (enforce && wt > 0) v = truncateToWordLimit(v, wt);\n            setDraft(v);\n          }}\n          onPaste={onDraftPaste}\n          readOnly={frozen}\n          placeholder={\n            frozen\n              ? 'Class is frozen by your teacher.'\n              : 'Write here… or paste an image (Ctrl+V / Cmd+V)'\n          }\n          className=\"min-h-[280px] flex-1 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-800 shadow-card outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 read-only:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:read-only:bg-slate-800\"\n        />\n""",
    """        <RichTextEditor\n          text={draft}\n          html={draftHtml}\n          onChange={({ text, html }) => {\n            setDraft(text);\n            setDraftHtml(html);\n          }}\n          onPaste={onDraftPaste}\n          disabled={frozen}\n          maxWords={enforce && wt > 0 ? wt : 0}\n          placeholder=\"Write here… or paste an image (Ctrl+V / Cmd+V)\"\n        />\n"""
)

replace_once(
    "client/src/pages/TeacherDashboard.jsx",
    """import LiveResponseTeacher from '../components/LiveResponseTeacher.jsx';\n""",
    """import LiveResponseTeacher from '../components/LiveResponseTeacher.jsx';\nimport RichTextDisplay from '../components/RichTextDisplay.jsx';\n"""
)

replace_once(
    "client/src/pages/TeacherDashboard.jsx",
    """    text: String(s.text ?? ''),\n    room_code: s.room_code != null ? String(s.room_code) : '',\n""",
    """    text: String(s.text ?? ''),\n    rich_text_html: String(s.rich_text_html ?? ''),\n    room_code: s.room_code != null ? String(s.room_code) : '',\n"""
)

replace_once(
    "client/src/pages/TeacherDashboard.jsx",
    """          cur.text === row.text &&\n          cur.updated_at === row.updated_at &&\n""",
    """          cur.text === row.text &&\n          cur.rich_text_html === row.rich_text_html &&\n          cur.updated_at === row.updated_at &&\n"""
)

replace_once(
    "client/src/pages/TeacherDashboard.jsx",
    """                  {displayText ||\n                    (!s.image_url && (\n                      <span className=\"italic text-slate-400 dark:text-slate-500\">No text yet</span>\n                    ))}\n""",
    """                  {displayText ? (\n                    <RichTextDisplay html={s.rich_text_html} text={displayText} />\n                  ) : !s.image_url ? (\n                    <span className=\"italic text-slate-400 dark:text-slate-500\">No text yet</span>\n                  ) : null}\n"""
)

replace_once(
    "client/src/pages/TeacherDashboard.jsx",
    """                            <p className=\"mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300\">{entry.text}</p>\n""",
    """                            <RichTextDisplay\n                              html={entry.rich_text_html}\n                              text={entry.text}\n                              className=\"mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300\"\n                            />\n"""
)

replace_once(
    "client/src/pages/TeacherDashboard.jsx",
    """                  <p className=\"mt-2 whitespace-pre-wrap text-slate-700 dark:text-slate-300\">{st.text || '—'}</p>\n""",
    """                  {st.text ? (\n                    <RichTextDisplay\n                      html={st.rich_text_html}\n                      text={st.text}\n                      className=\"mt-2 text-slate-700 dark:text-slate-300\"\n                    />\n                  ) : (\n                    <p className=\"mt-2 text-slate-500\">—</p>\n                  )}\n"""
)

replace_once(
    "client/src/pages/Whiteboard.jsx",
    """import FlipCountdown from '../components/FlipCountdown.jsx';\n""",
    """import FlipCountdown from '../components/FlipCountdown.jsx';\nimport RichTextDisplay from '../components/RichTextDisplay.jsx';\n"""
)

replace_once(
    "client/src/pages/Whiteboard.jsx",
    """    text: String(s.text ?? ''),\n    class_group: s.class_group != null ? String(s.class_group) : '',\n""",
    """    text: String(s.text ?? ''),\n    rich_text_html: String(s.rich_text_html ?? ''),\n    class_group: s.class_group != null ? String(s.class_group) : '',\n"""
)

replace_once(
    "client/src/pages/Whiteboard.jsx",
    """        {s.text?.trim() ? (\n          <p className=\"whitespace-pre-wrap break-words\">{s.text}</p>\n        ) : !s.image_url ? (\n""",
    """        {s.text?.trim() ? (\n          <RichTextDisplay html={s.rich_text_html} text={s.text} />\n        ) : !s.image_url ? (\n"""
)

replace_once(
    "client/src/pages/Whiteboard.jsx",
    """            return { ...s, text: old.text, updated_at: old.updated_at };\n""",
    """            return {\n              ...s,\n              text: old.text,\n              rich_text_html: old.rich_text_html,\n              updated_at: old.updated_at,\n            };\n"""
)

replace_once(
    "client/src/pages/Whiteboard.jsx",
    """        if (cur.text === n.text && cur.updated_at === n.updated_at && cur.name === n.name && cur.image_url === n.image_url) {\n""",
    """        if (\n          cur.text === n.text &&\n          cur.rich_text_html === n.rich_text_html &&\n          cur.updated_at === n.updated_at &&\n          cur.name === n.name &&\n          cur.image_url === n.image_url\n        ) {\n"""
)

replace_once(
    "server/db.js",
    """  try {\n    db.exec(`ALTER TABLE students ADD COLUMN year_level TEXT NOT NULL DEFAULT ''`);\n  } catch {\n    /* column already exists */\n  }\n""",
    """  try {\n    db.exec(`ALTER TABLE students ADD COLUMN year_level TEXT NOT NULL DEFAULT ''`);\n  } catch {\n    /* column already exists */\n  }\n  try {\n    db.exec(`ALTER TABLE students ADD COLUMN rich_text_html TEXT NOT NULL DEFAULT ''`);\n  } catch {\n    /* column already exists */\n  }\n"""
)

replace_once(
    "server/db.js",
    """  updateStudentText(db, studentId, text) {\n    run(db, `UPDATE students SET text = ?, updated_at = datetime('now') WHERE id = ?`, [\n      text,\n      studentId,\n    ]);\n    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);\n  },\n""",
    """  updateStudentText(db, studentId, text, richTextHtml = '') {\n    run(\n      db,\n      `UPDATE students SET text = ?, rich_text_html = ?, updated_at = datetime('now') WHERE id = ?`,\n      [text, String(richTextHtml || ''), studentId]\n    );\n    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);\n  },\n"""
)

replace_once(
    "server/db.js",
    """      `UPDATE students SET text = '', image_filename = '', updated_at = datetime('now') WHERE room_code = ?`,\n""",
    """      `UPDATE students SET text = '', rich_text_html = '', image_filename = '', updated_at = datetime('now') WHERE room_code = ?`,\n"""
)

replace_once(
    "server/db.js",
    """      text: row.text || '',\n      updated_at: row.updated_at,\n""",
    """      text: row.text || '',\n      rich_text_html: row.rich_text_html || '',\n      updated_at: row.updated_at,\n"""
)

replace_once(
    "server/index.js",
    """          classGroup: student.class_group != null ? String(student.class_group) : '',\n          text,\n        });\n""",
    """          classGroup: student.class_group != null ? String(student.class_group) : '',\n          text,\n          rich_text_html: String(student.rich_text_html || ''),\n        });\n"""
)

replace_once(
    "server/index.js",
    """  socket.on('student:text', ({ text }, cb) => {\n    try {\n      const sid = socket.data.studentId;\n      const code = socket.data.roomCode;\n      if (!sid || !code) {\n        cb?.({ ok: false });\n        return;\n      }\n      const roomRow = queries.ensureRoom(db, code);\n      let t = String(text ?? '');\n      if (roomRow.enforce_word_count && roomRow.word_target > 0) {\n        t = truncateToWordLimit(t, roomRow.word_target);\n      }\n      // Cap payload size so one huge paste cannot stall every teacher/iBoard client\n      if (t.length > 50_000) t = t.slice(0, 50_000);\n      const row = queries.updateStudentText(db, sid, t);\n""",
    """  socket.on('student:text', ({ text, richTextHtml }, cb) => {\n    try {\n      const sid = socket.data.studentId;\n      const code = socket.data.roomCode;\n      if (!sid || !code) {\n        cb?.({ ok: false });\n        return;\n      }\n      const roomRow = queries.ensureRoom(db, code);\n      const rawText = String(text ?? '');\n      let t = rawText;\n      if (roomRow.enforce_word_count && roomRow.word_target > 0) {\n        t = truncateToWordLimit(t, roomRow.word_target);\n      }\n      // Cap payload size so one huge paste cannot stall every teacher/iBoard client\n      if (t.length > 50_000) t = t.slice(0, 50_000);\n      let rich = String(richTextHtml ?? '');\n      if (rich.length > 100_000) rich = rich.slice(0, 100_000);\n      // If the server had to truncate the plain draft, discard formatting rather than\n      // show formatting that no longer lines up with the saved words.\n      if (t !== rawText) rich = '';\n      const row = queries.updateStudentText(db, sid, t, rich);\n"""
)

replace_once(
    "server/index.js",
    """        items.push({ label, text, image_url, from: 'student' });\n""",
    """        items.push({\n          label,\n          text,\n          rich_text_html: String(student.rich_text_html || '').slice(0, 30_000),\n          image_url,\n          from: 'student',\n        });\n"""
)

replace_once(
    "server/index.js",
    """          text: s.text || '',\n          updated_at: s.updated_at,\n""",
    """          text: s.text || '',\n          rich_text_html: s.rich_text_html || '',\n          updated_at: s.updated_at,\n"""
)

print("Rich-text patch applied.")
