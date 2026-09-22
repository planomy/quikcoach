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

function isWordChar(ch) {
  return /[\p{L}\p{N}’']/u.test(ch || '');
}

/** Pull in a missed first letter when the browser started the range one character late. */
export function includeMissedWordStart(text, start, end) {
  const source = String(text || '');
  const originalStart = Math.max(0, Number(start) || 0);
  let nextStart = originalStart;
  const nextEnd = Math.max(nextStart, Number(end) || nextStart);
  while (nextStart > 0 && originalStart - nextStart < 2 && isWordChar(source[nextStart - 1])) {
    nextStart -= 1;
  }
  if (nextStart < originalStart && (nextStart === 0 || !isWordChar(source[nextStart - 1]))) {
    return { start: nextStart, end: nextEnd };
  }
  return { start: originalStart, end: nextEnd };
}

function enoughNeighbour(stored, matchedLen) {
  const need = String(stored || '').length;
  if (!need) return true;
  return matchedLen >= Math.min(need, Math.max(2, Math.ceil(need * 0.35)));
}

/** True when this occurrence still sits in the original sentence, not a fresh paste. */
function quoteContextAgrees(source, index, needle, prefix, suffix) {
  const before = source.slice(Math.max(0, index - 48), index);
  const after = source.slice(index + needle.length, index + needle.length + 48);
  const prefixOk = enoughNeighbour(prefix, matchingPrefixLength(prefix, before));
  const suffixOk = enoughNeighbour(suffix, matchingSuffixLength(suffix, after));
  if (prefix && suffix) return prefixOk || suffixOk;
  return prefixOk && suffixOk;
}

/** Prefer the occurrence whose neighbours match — never a same-spelled word in new text. */
export function locateQuote(text, quote, hintStart, prefix = '', suffix = '') {
  const source = String(text || '');
  const needle = String(quote || '');
  if (!needle) return null;
  const hint = Math.max(0, Number(hintStart) || 0);
  const storedPrefix = String(prefix || '');
  const storedSuffix = String(suffix || '');
  if (
    source.slice(hint, hint + needle.length) === needle &&
    quoteContextAgrees(source, hint, needle, storedPrefix, storedSuffix)
  ) {
    return hint;
  }
  for (const delta of [-1, 1, -2, 2]) {
    const at = hint + delta;
    if (
      at >= 0 &&
      source.slice(at, at + needle.length) === needle &&
      quoteContextAgrees(source, at, needle, storedPrefix, storedSuffix)
    ) {
      return at;
    }
  }

  const matches = [];
  let cursor = 0;
  while (cursor <= source.length - needle.length) {
    const index = source.indexOf(needle, cursor);
    if (index === -1) break;
    if (!quoteContextAgrees(source, index, needle, storedPrefix, storedSuffix)) {
      cursor = index + Math.max(1, needle.length);
      continue;
    }
    const before = source.slice(Math.max(0, index - 48), index);
    const after = source.slice(index + needle.length, index + needle.length + 48);
    const prefixScore = matchingPrefixLength(storedPrefix, before);
    const suffixScore = matchingSuffixLength(storedSuffix, after);
    const distance = Math.abs(index - hint);
    matches.push({
      index,
      score: prefixScore * 20 + suffixScore * 20 - Math.min(distance, 1000) / 25,
    });
    cursor = index + Math.max(1, needle.length);
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.score - a.score || Math.abs(a.index - hint) - Math.abs(b.index - hint));
  return matches[0].index;
}

export function resolveAnnotation(annotation, rawText) {
  const text = normalise(rawText);
  const quote = normalise(annotation?.quote || '');
  const expectedStart = Math.max(0, Number(annotation?.start_offset) || 0);
  const expectedEnd = Math.max(expectedStart, Number(annotation?.end_offset) || expectedStart);
  if (!quote) return { ...annotation, detached: true, start: expectedStart, end: expectedEnd };

  const located = locateQuote(
    text,
    quote,
    expectedStart,
    annotation?.prefix_context || '',
    annotation?.suffix_context || ''
  );
  if (located != null) {
    return { ...annotation, detached: false, start: located, end: located + quote.length };
  }
  const replacement = inferReplacementPassage(annotation, text);
  if (replacement?.after?.trim() && replacement.end > replacement.start) {
    return {
      ...annotation,
      detached: true,
      start: replacement.start,
      end: replacement.end,
      replacement,
    };
  }
  return { ...annotation, detached: true, start: expectedStart, end: expectedEnd };
}

/** Highlight the original quote, or the tight replacement once that quote is gone. */
export function locateAnnotationRange(root, annotation, rawText) {
  const text = normalise(rawText);
  const resolved = resolveAnnotation(annotation, text);
  const canHighlight = !resolved.detached || Boolean(resolved.replacement?.after?.trim());
  const liveQuote = canHighlight ? text.slice(resolved.start, resolved.end) : '';
  const range =
    canHighlight && liveQuote
      ? rangeForPlainOffsets(
          root,
          resolved.start,
          resolved.end,
          liveQuote,
          annotation?.prefix_context || '',
          annotation?.suffix_context || ''
        )
      : null;
  return { resolved, range };
}

/** open | reopen | fixed | resolved — reopen = teacher Check again */
export function commentTone(annotation, detached = false) {
  if (annotation?.status === 'resolved') return 'resolved';
  if (annotation?.status === 'fixed') return 'fixed';
  if (annotation?.student_fixed_at) return 'reopen';
  if (detached) return 'fixed';
  return 'open';
}

/** Unread / check-again sit in the left gutter; reviewed sit to the right. */
export function commentGutterLane(tone) {
  return tone === 'open' || tone === 'reopen' ? 'attention' : 'done';
}

/** Keep cached gutter pips in lockstep with confirm/reopen — same lane is not enough. */
export function annotationMarkersMatch(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      Number(left.studentId || 0) !== Number(right.studentId || 0) ||
      Number(left.annotation?.id) !== Number(right.annotation?.id) ||
      String(left.annotation?.status || '') !== String(right.annotation?.status || '') ||
      String(left.annotation?.student_fixed_at || '') !== String(right.annotation?.student_fixed_at || '') ||
      left.detached !== right.detached ||
      left.position !== right.position ||
      left.layout !== right.layout ||
      left.lane !== right.lane ||
      Math.abs((left.top || 0) - (right.top || 0)) > 0.5 ||
      Math.abs((left.left || 0) - (right.left || 0)) > 0.5 ||
      Math.abs((left.width || 0) - (right.width || 0)) > 0.5
    ) {
      return false;
    }
  }
  return true;
}

function tokenCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function tokenEnd(text, start) {
  const source = String(text || '');
  let i = Math.max(0, Math.min(source.length, start));
  if (i >= source.length) return i;
  if (!isWordChar(source[i])) {
    if (/\s/.test(source[i])) return i;
    while (i < source.length && !isWordChar(source[i]) && !/\s/.test(source[i])) i += 1;
    return i;
  }
  while (i < source.length && isWordChar(source[i])) i += 1;
  return i;
}

function spanTokens(text, start, count) {
  const source = String(text || '');
  let i = Math.max(0, start);
  let n = 0;
  while (i < source.length && n < count) {
    if (/\s/.test(source[i])) {
      i += 1;
      continue;
    }
    const next = tokenEnd(source, i);
    if (next === i) break;
    i = next;
    n += 1;
  }
  return i;
}

function tightReplacementEnd(text, start, quote) {
  const tokens = Math.max(1, tokenCount(quote));
  return tokenCount(quote) <= 1 ? tokenEnd(text, start) : spanTokens(text, start, tokens);
}

function findPrefixEnd(text, prefix, expectedStart) {
  let best = -1;
  let bestDist = Infinity;
  let cursor = 0;
  while (cursor <= text.length - prefix.length) {
    const index = text.indexOf(prefix, cursor);
    if (index === -1) break;
    const afterPrefix = index + prefix.length;
    const dist = Math.abs(afterPrefix - expectedStart);
    if (dist < bestDist) {
      bestDist = dist;
      best = afterPrefix;
    }
    cursor = index + 1;
  }
  return best;
}

function tokenStartBefore(text, end, count) {
  const source = String(text || '');
  let i = Math.max(0, Math.min(source.length, end));
  let n = 0;
  while (i > 0 && n < count) {
    i -= 1;
    if (/\s/.test(source[i])) continue;
    while (i > 0 && isWordChar(source[i - 1])) i -= 1;
    n += 1;
    if (n >= count) return i;
    while (i > 0 && /\s/.test(source[i - 1])) i -= 1;
  }
  return i;
}

/** When a quote can no longer be found, recover only the word or phrase that replaced it. */
export function inferReplacementPassage(annotation, rawText) {
  const text = normalise(rawText);
  const quote = normalise(annotation?.quote || '');
  const prefix = normalise(annotation?.prefix_context || '');
  const suffix = normalise(annotation?.suffix_context || '');
  const expectedStart = Math.max(0, Number(annotation?.start_offset) || 0);
  if (!quote) return null;

  let start = -1;
  if (prefix) {
    start = findPrefixEnd(text, prefix, expectedStart);
    if (start < 0) return null;
  } else if (suffix) {
    const suffixAt = text.indexOf(suffix);
    if (suffixAt < 0) return null;
    start = tokenStartBefore(text, suffixAt, Math.max(1, tokenCount(quote)));
  } else {
    return null;
  }

  let end = tightReplacementEnd(text, start, quote);
  if (suffix) {
    const index = text.indexOf(suffix, start);
    if (index >= start) {
      const between = text.slice(start, index);
      const originalTokens = Math.max(1, tokenCount(quote));
      const betweenTokens = tokenCount(between);
      if (
        betweenTokens > 0 &&
        betweenTokens <= originalTokens + 1 &&
        between.length <= Math.max(quote.length * 3, 24)
      ) {
        end = index;
      }
    }
  }

  const after = text.slice(start, end);
  if (!after.trim() || after === quote) return null;
  return { before: quote, after, start, end };
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
    // Marker/popups are portaled into the writing pane; never count them as text.
    if (node.hasAttribute?.('data-teacher-annotation-ui')) return;
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

function firstTextDescendant(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node;
  for (const child of Array.from(node.childNodes || [])) {
    const found = firstTextDescendant(child);
    if (found) return found;
  }
  return null;
}

function lastTextDescendant(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node;
  const children = Array.from(node.childNodes || []);
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const found = lastTextDescendant(children[i]);
    if (found) return found;
  }
  return null;
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
      // Offset past the last mapped character of this node — start just after it.
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        const token = tokens[i];
        if (!token.virtual && token.node === node) return i + 1;
      }
    }
    return -1;
  }

  // RTL / block-boundary selections often report element containers + child offsets.
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (preferEnd) {
      if (offset <= 0) {
        const first = firstTextDescendant(node);
        return first ? tokenIndexForDomPoint(tokens, first, 0, false) : -1;
      }
      const prev = node.childNodes[offset - 1];
      if (!prev) return -1;
      if (prev.nodeType === Node.TEXT_NODE) {
        return tokenIndexForDomPoint(tokens, prev, String(prev.nodeValue || '').length, true);
      }
      const last = lastTextDescendant(prev);
      return last ? tokenIndexForDomPoint(tokens, last, String(last.nodeValue || '').length, true) : -1;
    }
    if (offset >= node.childNodes.length) {
      const last = lastTextDescendant(node);
      return last ? tokenIndexForDomPoint(tokens, last, String(last.nodeValue || '').length, true) : -1;
    }
    const child = node.childNodes[offset];
    if (!child) return -1;
    if (child.nodeType === Node.TEXT_NODE) {
      return tokenIndexForDomPoint(tokens, child, 0, false);
    }
    const first = firstTextDescendant(child);
    return first ? tokenIndexForDomPoint(tokens, first, 0, false) : -1;
  }
  return -1;
}

export function selectionOffsetsWithin(root, rawExpectedText) {
  if (!root || typeof window === 'undefined') return null;
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const tokens = mappedPlainTokens(root);
  const mappedText = tokens.map((token) => token.char).join('');
  const expectedText = normalise(rawExpectedText);
  const sourceText = mappedText || expectedText;
  let mappedStart = tokenIndexForDomPoint(tokens, range.startContainer, range.startOffset, false);
  let mappedEnd = tokenIndexForDomPoint(tokens, range.endContainer, range.endOffset, true);

  const selectedRange = range.cloneRange();
  const selectedText = fragmentToPlainText(selectedRange.cloneContents());
  const rawQuote = normalise(selectedText);
  let quote = rawQuote.trim();
  if (!quote) return null;

  if (mappedStart < 0 || mappedEnd < mappedStart) {
    const prefixRange = document.createRange();
    prefixRange.setStart(root, 0);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    mappedStart = fragmentToPlainText(prefixRange.cloneContents()).length;
    mappedEnd = mappedStart + rawQuote.length;
  }

  // Trim only affects the stored quote — keep offsets on the real selected span.
  const leadWs = rawQuote.length - rawQuote.trimStart().length;
  let start = mappedStart + leadWs;
  let end = start + quote.length;
  const expanded = includeMissedWordStart(sourceText, start, end);
  start = expanded.start;
  end = expanded.end;
  quote = sourceText.slice(start, end).trim() || quote;
  end = start + quote.length;

  const prefixHint = sourceText.slice(Math.max(0, start - 48), start);
  const suffixHint = sourceText.slice(end, end + 48);
  const located = locateQuote(sourceText, quote, start, prefixHint, suffixHint);
  if (located == null) return null;
  start = located;
  end = start + quote.length;

  return {
    start,
    end,
    quote,
    prefix: sourceText.slice(Math.max(0, start - 48), start),
    suffix: sourceText.slice(end, end + 48),
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

export function rangeForPlainOffsets(root, start, end, quote = '', prefix = '', suffix = '') {
  if (!root || typeof document === 'undefined') return null;
  const tokens = mappedPlainTokens(root);
  if (!tokens.length) return null;
  const mappedText = tokens.map((token) => token.char).join('');
  let from = Math.max(0, Number(start) || 0);
  let to = Math.max(from, Number(end) || from);
  const needle = normalise(quote);
  if (needle && mappedText.slice(from, to) !== needle) {
    const located = locateQuote(mappedText, needle, from, prefix, suffix);
    if (located != null) {
      from = located;
      to = from + needle.length;
    }
  }
  const aIndex = Math.max(0, Math.min(tokens.length - 1, from));
  const bIndex = Math.max(0, Math.min(tokens.length - 1, Math.max(0, to - 1)));
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
  return mappedPlainTokens(element).map((token) => token.char).join('');
}

/** Prefer the writing-content root so chrome (images, mark-up buttons) is excluded. */
export function writingRootForPane(textPane) {
  if (!textPane) return null;
  return (
    textPane.querySelector?.('[data-iboard-writing-content]') ||
    textPane.querySelector?.('.whitespace-pre-wrap') ||
    textPane
  );
}

export const COMMENT_HOVER_WASH = {
  open: 'rgba(90, 95, 195, 0.5)',
  reopen: 'rgba(244, 63, 94, 0.46)',
  fixed: 'rgba(107, 107, 120, 0.46)',
  resolved: 'rgba(16, 185, 129, 0.48)',
};

const highlightSignatureCache = new Map();

function highlightSignature(ranges) {
  if (!ranges?.length) return '';
  return ranges.map((range) => {
    try {
      return `${range.startOffset}:${range.endOffset}:${range.toString()}`;
    } catch {
      return 'x';
    }
  }).join('|');
}

export function setNamedHighlight(name, ranges) {
  if (!globalThis.CSS?.highlights || typeof globalThis.Highlight === 'undefined') return;
  const list = Array.isArray(ranges) ? ranges.filter(Boolean) : ranges ? [ranges] : [];
  const signature = highlightSignature(list);
  if (highlightSignatureCache.get(name) === signature) return;
  highlightSignatureCache.set(name, signature);
  if (list.length) globalThis.CSS.highlights.set(name, new globalThis.Highlight(...list));
  else globalThis.CSS.highlights.delete(name);
}

export function rangeContainsPoint(range, x, y, pad = 3) {
  if (!range) return false;
  try {
    for (const rect of range.getClientRects()) {
      if (x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function setCommentHoverHighlight(name, range) {
  setNamedHighlight(name, range ? [range] : []);
}

/** Keep same-line margin bubbles from sitting on top of each other. */
export function stackGutterMarkers(markers, gapFor = () => 18) {
  const orphans = [];
  const groups = new Map();
  for (const marker of markers || []) {
    if (marker.layout === 'orphan' || marker.detached) {
      orphans.push(marker);
      continue;
    }
    const key = `${marker.studentId != null ? marker.studentId : 'self'}:${marker.lane || 'done'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(marker);
  }
  const next = [];
  for (const group of groups.values()) {
    group.sort((a, b) => (a.top - b.top) || (a.left - b.left));
    let last = -Infinity;
    for (const marker of group) {
      const gap = Number(gapFor(marker)) || 18;
      const top = marker.top < last + gap ? last + gap : marker.top;
      last = top;
      next.push(top === marker.top ? marker : { ...marker, top });
    }
  }
  return next.concat(orphans);
}
