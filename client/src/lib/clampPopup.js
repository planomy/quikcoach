import { viewportBox } from './viewport.js';

/**
 * Clamp a fixed-position popup so it stays inside the visible viewport.
 * @param {{ top: number, left: number, width: number, height: number, padding?: number }} box
 */
export function clampFixedBox({ top, left, width, height, padding = 10 }) {
  const vp = viewportBox();
  const minTop = vp.top + padding;
  const minLeft = vp.left + padding;
  const maxTop = vp.top + vp.height - height - padding;
  const maxLeft = vp.left + vp.width - width - padding;
  return {
    top: Math.max(minTop, Math.min(maxTop, top)),
    left: Math.max(minLeft, Math.min(maxLeft, left)),
  };
}

/**
 * Choose above/below once, and stay there unless the locked side overflows
 * by more than hysteresis. Stops bottom-edge flip loops.
 */
export function pickPopupSide({
  spaceBelow,
  spaceAbove,
  prefer = 'below',
  lock = null,
  hysteresis = 16,
}) {
  const fits = (space) => space >= 0;
  const keep = (space) => space >= -hysteresis;
  if (lock === 'below' && keep(spaceBelow)) return 'below';
  if (lock === 'above' && keep(spaceAbove)) return 'above';
  if (prefer === 'above') {
    if (fits(spaceAbove)) return 'above';
    if (fits(spaceBelow)) return 'below';
  } else {
    if (fits(spaceBelow)) return 'below';
    if (fits(spaceAbove)) return 'above';
  }
  return spaceBelow >= spaceAbove ? 'below' : 'above';
}

/**
 * Pick popup placement beside or below an anchor rect.
 * @param {{ anchor: DOMRect, width: number, height: number, gap?: number, padding?: number, prefer?: 'above'|'below'|'below-left'|'right', lock?: 'above'|'below'|null, hysteresis?: number }} opts
 */
export function placementNearAnchor({
  anchor,
  width,
  height,
  gap = 8,
  padding = 10,
  prefer = 'above',
  lock = null,
  hysteresis = 16,
}) {
  const vp = viewportBox();
  const aboveTop = anchor.top - gap - height;
  const belowTop = anchor.bottom + gap;
  const spaceBelow = vp.top + vp.height - padding - belowTop - height;
  const spaceAbove = aboveTop - (vp.top + padding);
  const verticalPrefer = prefer === 'above' ? 'above' : 'below';
  const side = pickPopupSide({
    spaceBelow,
    spaceAbove,
    prefer: verticalPrefer,
    lock,
    hysteresis,
  });
  const top = side === 'below' ? belowTop : aboveTop;

  const centerX = anchor.left + anchor.width / 2 - width / 2;
  const rightLeft = anchor.right + gap;
  const leftLeft = anchor.left - gap - width;
  const belowLeft = anchor.right - width;
  const leftCandidates = prefer === 'below-left'
    ? [belowLeft, centerX, leftLeft]
    : prefer === 'right'
      ? [rightLeft, leftLeft, centerX]
      : [centerX, rightLeft, leftLeft];

  let left = leftCandidates[0];
  for (const candidate of leftCandidates) {
    if (
      candidate >= vp.left + padding
      && candidate + width <= vp.left + vp.width - padding
    ) {
      left = candidate;
      break;
    }
  }

  return { ...clampFixedBox({ top, left, width, height, padding }), side };
}
