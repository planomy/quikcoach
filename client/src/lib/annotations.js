import { richHtmlToPlainText } from './richText.js';

const BLOCK_TAGS = new Set(['div', 'p', 'li']);

function normalise(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function matchingPrefixLength(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const max = Math.min(left.length, right.length);
  let n = 0;
  while (n < max && left[left.length - 1 - n] === right[right.length - 1 - n]) n += 1;
  return n;
}

function matchingSuffixLength(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const max = Math.min(left.length, right.length);
  let n = 0;
  while (n < max && left[n] === right[n]) n += 1;
  return n;
}

export function resolveAnnotation(annotation, rawText) {
  const text = normalise(rawText);
  const quote = normalise(annotation?.quote || '');
  const expectedStart = Math.max(0, Number(annotation?.start_offset) || 0);
  const expectedEnd = Math.max(expectedStart, Number(annotation?.end_offset) || expectedStart);
  if (!quote) return { ...annotation, detached: true, start: expectedStart, end: expectedEnd };

  if (text.slice(expectedStart, expectedStart + quote.length) === quote) {
    return { ...annotation, detached: false, start: expectedStart, end: expectedStart + quote.length };
  }

  const matches = [];
  let cursor = 0;
  while (cursor <= text.length - quote.length) {
    const index = text.indexOf(quote, cursor);
    if (index === -1) break;
    const before = text.slice(Math.max(0, index - 48), index);
    const after = text.slice(index + quote.length, index + quote.length + 48);
    const prefixScore = matchingPrefixLength(annotation?.prefix_context || '', before);
    const suffixScore = matchingSuffixLength(annotation?.suffix_context || '', after);
    const distance = Math.abs(index - expectedStart);
    matches.push({ index, score: prefixScore * 20 + suffixScore * 20 - Math.min(distance, 1000) / 25 });
    cursor = index + Math.max(1, quote.length);
  }

  if (!matches.length) {
    return { ...annotation, detached: true, start: expectedStart, end: expectedEnd };
  }

  matches.sort((a, b) => b.score - a.score || Math.abs(a.index - expectedStart) - Math.abs(b.index - expectedStart));
  const best = matches[0].index;
  return { ...annotation, detached: false, start: best, end: best + quote.length };
}

function fragmentToPlainText(fragment) {
  if (!fragment || typeof document === 'undefined') return '';
  const holder = document.createElement('div');
  holder.appendChild(fragment.cloneNode(true));
  return richHtmlToPlainText(holder.innerHTML);
}

function mappedPlainTokens(root) {
  const raw = [];

  function pushVirtualNewline(node) {
    raw.push({ char: '\n', virtual: true, node });
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const value = String(node.nodeValue || '').replace(/\u00a0/g, ' ');
      for (let i = 0; i < value.length; i += 1) {
        raw.push({
          char: value[i],
          virtual: false,
          node,
          startOffset: i,
          endOffset: i + 1,
        });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'br') {
      pushVirtualNewline(node);
      return;
    }
    for (const child of Array.from(node.childNodes || [])) walk(child);
    if (node !== root && BLOCK_TAGS.has(tag)) pushVirtualNewline(node);
  }

  for (const child of Array.from(root.childNodes || [])) walk(child);

  // Match richHtmlToPlainText normalisation while retaining DOM positions for real characters.
  const noTrailingSpaces = [];
  for (const token of raw) {
    if (token.char === '\n') {
      while (
        noTrailingSpaces.length &&
        (noTrailingSpaces[noTrailingSpaces.length - 1].char === ' ' ||
          noTrailingSpaces[noTrailingSpaces.length - 1].char === '\t')
      ) {
        noTrailingSpaces.pop();
      }
    }
    noTrailingSpaces.push(token);
  }

  const collapsed = [];
  for (const token of noTrailingSpaces) {
    if (
      token.char === '\n' &&
      collapsed.length >= 2 &&
      collapsed[collapsed.length - 1].char === '\n' &&
      collapsed[collapsed.length - 2].char === '\n'
    ) {
      continue;
    }
    collapsed.push(token);
  }
  while (collapsed.length && collapsed[collapsed.length - 1].char === '\n') collapsed.pop();
  return collapsed;
}

function tokenIndexForDomPoint(tokens, node, offset, preferEnd = false) {
  if (!node) return -1;
  if (node.nodeType === Node.TEXT_NODE) {
    if (preferEnd) {
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        const token = tokens[i];
        if (!token.virtual && token.node === node && token.endOffset <= offset) return i + 1;
      }
    } else {
      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (!token.virtual && token.node === node && token.startOffset >= offset) return i;
      }
    }
  }
  return -1;
}

export function selectionOffsetsWithin(root, rawExpectedText) {
  if (!root || typeof window === 'undefined') return null;
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const expectedText = normalise(rawExpectedText);
  const tokens = mappedPlainTokens(root);
  const mappedText = tokens.map((token) => token.char).join('');
  let mappedStart = tokenIndexForDomPoint(tokens, range.startContainer, range.startOffset, false);
  let mappedEnd = tokenIndexForDomPoint(tokens, range.endContainer, range.endOffset, true);

  const selectedRange = range.cloneRange();
  const selectedText = fragmentToPlainText(selectedRange.cloneContents());
  const quote = normalise(selectedText).trim();
  if (!quote) return null;

  if (mappedStart < 0 || mappedEnd < mappedStart) {
    const prefixRange = document.createRange();
    prefixRange.setStart(root, 0);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    mappedStart = fragmentToPlainText(prefixRange.cloneContents()).length;
    mappedEnd = mappedStart + quote.length;
  }

  let start = mappedStart;
  let end = start + quote.length;
  const sourceText = mappedText === expectedText ? mappedText : expectedText;
  if (sourceText.slice(start, end) !== quote) {
    const nearest = [];
    let cursor = 0;
    while (cursor <= expectedText.length - quote.length) {
      const index = expectedText.indexOf(quote, cursor);
      if (index === -1) break;
      nearest.push(index);
      cursor = index + Math.max(1, quote.length);
    }
    if (!nearest.length) return null;
    nearest.sort((a, b) => Math.abs(a - start) - Math.abs(b - start));
    start = nearest[0];
    end = start + quote.length;
  }

  return {
    start,
    end,
    quote,
    prefix: expectedText.slice(Math.max(0, start - 48), start),
    suffix: expectedText.slice(end, end + 48),
  };
}

function nearestRealToken(tokens, index, direction) {
  let i = index;
  while (i >= 0 && i < tokens.length) {
    if (!tokens[i].virtual) return tokens[i];
    i += direction;
  }
  return null;
}

export function rangeForPlainOffsets(root, start, end) {
  if (!root || typeof document === 'undefined') return null;
  const tokens = mappedPlainTokens(root);
  if (!tokens.length) return null;
  const aIndex = Math.max(0, Math.min(tokens.length - 1, Number(start) || 0));
  const bIndex = Math.max(0, Math.min(tokens.length - 1, Math.max(0, (Number(end) || 0) - 1)));
  const a = nearestRealToken(tokens, aIndex, 1) || nearestRealToken(tokens, aIndex, -1);
  const b = nearestRealToken(tokens, bIndex, -1) || nearestRealToken(tokens, bIndex, 1);
  if (!a?.node || !b?.node) return null;
  try {
    const range = document.createRange();
    range.setStart(a.node, a.startOffset);
    range.setEnd(b.node, b.endOffset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

export function plainTextFromElement(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  clone.querySelectorAll?.('[data-teacher-annotation-ui]').forEach((node) => node.remove());
  return richHtmlToPlainText(clone.innerHTML);
}
