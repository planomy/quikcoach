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
 * @param {{ anchor: DOMRect, width: number, height: number, gap?: number, padding?: number, prefer?: 'above'|'below'|'below-left'|'right' }} opts
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
  // Align the panel's right edge with the anchor (opens under + to the left).
  const belowLeft = anchor.right - width;

  if (prefer === 'above') {
    candidates.push({ top: aboveTop, left: centerX });
    candidates.push({ top: belowTop, left: centerX });
  } else if (prefer === 'below') {
    candidates.push({ top: belowTop, left: centerX });
    candidates.push({ top: aboveTop, left: centerX });
  } else if (prefer === 'below-left') {
    candidates.push({ top: belowTop, left: belowLeft });
    candidates.push({ top: belowTop, left: centerX });
    candidates.push({ top: aboveTop, left: belowLeft });
    candidates.push({ top: aboveTop, left: centerX });
    candidates.push({ top: belowTop, left: leftLeft });
  } else {
    candidates.push({ top: anchor.top, left: rightLeft });
    candidates.push({ top: anchor.top, left: leftLeft });
  }

  candidates.push({ top: belowTop, left: rightLeft });
  candidates.push({ top: anchor.top - height / 2, left: rightLeft });
  candidates.push({ top: belowTop, left: leftLeft });

  const fitsUnclamped = (candidate) => (
    candidate.top >= vp.top + padding
    && candidate.top + height <= vp.top + vp.height - padding
    && candidate.left >= vp.left + padding
    && candidate.left + width <= vp.left + vp.width - padding
  );

  // Prefer a placement that already fits without sliding away from the anchor.
  for (const candidate of candidates) {
    if (fitsUnclamped(candidate)) return candidate;
  }

  // Fall back to the nearest in-viewport clamp (usually below the anchor).
  return clampFixedBox({
    top: anchor.bottom + gap,
    left: centerX,
    width,
    height,
    padding,
  });
}
