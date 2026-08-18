import { richHtmlToPlainText } from './richText.js';

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

export function selectionOffsetsWithin(root, rawExpectedText) {
  if (!root || typeof window === 'undefined') return null;
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const expectedText = normalise(rawExpectedText);
  const prefixRange = document.createRange();
  prefixRange.setStart(root, 0);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const selectedRange = range.cloneRange();

  const prefixText = fragmentToPlainText(prefixRange.cloneContents());
  const selectedText = fragmentToPlainText(selectedRange.cloneContents());
  const quote = normalise(selectedText).trim();
  if (!quote) return null;

  let start = prefixText.length;
  let end = start + quote.length;
  if (expectedText.slice(start, end) !== quote) {
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

function pointForPlainOffset(root, target, preferEnd = false) {
  if (!root || typeof document === 'undefined') return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let last = null;
  while (node) {
    const beforeRange = document.createRange();
    beforeRange.setStart(root, 0);
    beforeRange.setEnd(node, 0);
    const before = fragmentToPlainText(beforeRange.cloneContents());
    const start = before.length;
    const end = start + (node.nodeValue || '').length;
    if (target >= start && target <= end) {
      return { node, offset: Math.max(0, Math.min((node.nodeValue || '').length, target - start)) };
    }
    if (target < start && last) return preferEnd ? last : { node, offset: 0 };
    last = { node, offset: (node.nodeValue || '').length };
    node = walker.nextNode();
  }
  return last;
}

export function rangeForPlainOffsets(root, start, end) {
  if (!root || typeof document === 'undefined') return null;
  const a = pointForPlainOffset(root, Math.max(0, Number(start) || 0), false);
  const b = pointForPlainOffset(root, Math.max(0, Number(end) || 0), true);
  if (!a || !b) return null;
  try {
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
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
