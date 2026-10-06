/** Laser mice jitter into the line padding; the browser then snaps the range to the block start. */

function caretRangeFromPoint(x, y) {
  if (typeof document === 'undefined') return null;
  if (typeof document.caretRangeFromPoint === 'function') {
    try {
      return document.caretRangeFromPoint(x, y);
    } catch {
      return null;
    }
  }
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos?.offsetNode) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

function closestBlock(node, root) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const block = el?.closest?.('p, div, li, [data-iboard-writing-content], [role="textbox"]');
  if (block && (!root || root.contains(block))) return block;
  return root || null;
}

function rangeIsAtBlockStart(range, root) {
  const block = closestBlock(range.startContainer, root);
  if (!block) return false;
  try {
    const probe = document.createRange();
    probe.selectNodeContents(block);
    probe.setEnd(range.startContainer, range.startOffset);
    return !String(probe.toString() || '').replace(/^\s+/, '');
  } catch {
    return false;
  }
}

export function isMousePointer(event) {
  const type = event?.pointerType;
  if (type) return type === 'mouse';
  return event?.type !== 'touchend' && event?.type !== 'touchstart';
}

export function beginMouseSelectIntent(event, root) {
  if (!isMousePointer(event)) return null;
  if (event.button != null && event.button !== 0) return null;
  const caret = caretRangeFromPoint(event.clientX, event.clientY);
  if (!caret || (root && !root.contains(caret.startContainer))) return null;
  let lineTop = event.clientY;
  try {
    const rect = caret.getBoundingClientRect();
    if (rect?.height) lineTop = rect.top;
  } catch {
    /* empty caret */
  }
  return {
    root: root || null,
    caret,
    lineTop,
    minY: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
  };
}

export function noteMouseSelectIntent(intent, event) {
  if (!intent || event?.clientY == null) return intent;
  intent.minY = Math.min(intent.minY, event.clientY);
  return intent;
}

/** Undo a block-start snap when the drag never left the starting line upward. */
export function clampMouseSelectSnap(intent, event) {
  if (!intent?.caret || typeof window === 'undefined') return false;
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const root = intent.root;
  if (root && (!root.contains(range.startContainer) || !root.contains(range.endContainer))) return false;
  if (intent.minY < intent.lineTop - 8) return false;
  const x = event?.clientX ?? intent.startX;
  const y = event?.clientY ?? intent.startY;
  if (Math.hypot(x - intent.startX, y - intent.startY) < 4) return false;
  if (!rangeIsAtBlockStart(range, root)) return false;
  if (rangeIsAtBlockStart(intent.caret, root)) return false;
  try {
    if (range.comparePoint(intent.caret.startContainer, intent.caret.startOffset) !== 0) return false;
    range.setStart(intent.caret.startContainer, intent.caret.startOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}
