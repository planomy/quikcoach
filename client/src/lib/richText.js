const BLOCK_TAGS = new Set([
  'div', 'p', 'li', 'ul', 'ol', 'tr', 'table', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'pre',
]);

/** Tags we keep in stored HTML. Unknown blocks are unwrapped but still force a line break. */
const KEPT_TAGS = new Set(['div', 'p', 'strong', 'em', 'u', 'mark', 'ul', 'ol', 'li', 'br']);

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

  const tag = rawTag === 'b' ? 'strong' : rawTag === 'i' ? 'em' : rawTag;
  if (KEPT_TAGS.has(tag) && tag !== 'br') {
    return `<${tag}>${children}</${tag}>`;
  }
  // Headings / unknown blocks: unwrap content but keep a paragraph break so
  // "Trouble" + next line never become "TroubleRunning" in plain text / PDF.
  if (BLOCK_TAGS.has(rawTag)) {
    return `<div>${children || '<br>'}</div>`;
  }
  return children;
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

  const body = plainFromChildren(node.childNodes || []);
  return BLOCK_TAGS.has(tag) ? `${body}\n` : body;
}

/** Keep a break when unwrapped heading text sits beside the next block (`Trouble` + `<div>Who`). */
function plainFromChildren(nodes) {
  let out = '';
  for (const node of Array.from(nodes || [])) {
    const isBlock = node.nodeType === 1 && BLOCK_TAGS.has(String(node.tagName || '').toLowerCase());
    const chunk = plainFromNode(node);
    if (!chunk) continue;
    if (isBlock && out && !out.endsWith('\n')) out += '\n';
    out += chunk;
  }
  return out;
}

export function richHtmlToPlainText(rawHtml) {
  const html = sanitizeRichHtml(rawHtml);
  if (!html || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return plainFromChildren(doc.body.childNodes || [])
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/g, '');
}

/** PDF / Node-safe plain text: prefer HTML structure, fall back to stored plain text. */
export function writingPlainFromStudent(student = {}) {
  const html = String(student.rich_text_html || '');
  const fallback = String(student.text || '');
  if (html.trim() && typeof DOMParser !== 'undefined') {
    const plain = richHtmlToPlainText(html);
    if (plain.trim()) return plain;
  }
  if (html.trim()) {
    const fromHtml = html
      .replace(/\r\n?/g, '\n')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*(p|div|li|h[1-6]|tr|blockquote|section|article|header|footer|pre|ul|ol|table)\b[^>]*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|blockquote|section|article|header|footer|pre)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#039;/gi, "'")
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/g, '');
    if (fromHtml.trim()) return fromHtml;
  }
  return fallback;
}

export function plainTextToRichHtml(rawText) {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n');
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => `<div>${line ? escapeHtml(line) : '<br>'}</div>`)
    .join('');
}
