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
 * Pick popup placement beside or below an anchor rect.
 * @param {{ anchor: DOMRect, width: number, height: number, gap?: number, padding?: number, prefer?: 'above'|'below'|'right' }} opts
 */
export function placementNearAnchor({
  anchor,
  width,
  height,
  gap = 8,
  padding = 10,
  prefer = 'above',
}) {
  const vp = viewportBox();
  const candidates = [];

  const aboveTop = anchor.top - gap - height;
  const belowTop = anchor.bottom + gap;
  const rightLeft = anchor.right + gap;
  const leftLeft = anchor.left - gap - width;
  const centerX = anchor.left + anchor.width / 2 - width / 2;

  if (prefer === 'above') {
    candidates.push({ top: aboveTop, left: centerX });
    candidates.push({ top: belowTop, left: centerX });
  } else if (prefer === 'below') {
    candidates.push({ top: belowTop, left: centerX });
    candidates.push({ top: aboveTop, left: centerX });
  } else {
    candidates.push({ top: anchor.top, left: rightLeft });
    candidates.push({ top: anchor.top, left: leftLeft });
  }

  candidates.push({ top: belowTop, left: rightLeft });
  candidates.push({ top: anchor.top - height / 2, left: rightLeft });
  candidates.push({ top: belowTop, left: leftLeft });

  for (const candidate of candidates) {
    const clamped = clampFixedBox({ ...candidate, width, height, padding });
    const fitsVert =
      clamped.top >= vp.top + padding && clamped.top + height <= vp.top + vp.height - padding;
    const fitsHoriz =
      clamped.left >= vp.left + padding && clamped.left + width <= vp.left + vp.width - padding;
    if (fitsVert && fitsHoriz) return clamped;
  }

  return clampFixedBox({
    top: anchor.bottom + gap,
    left: centerX,
    width,
    height,
    padding,
  });
}
