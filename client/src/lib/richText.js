const BLOCK_TAGS = new Set(['div', 'p', 'li']);

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
