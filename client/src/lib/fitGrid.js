/**
 * Pick a column count so `count` cards fill a `width` × `height` area as large as possible.
 * Cards prefer a slightly wide shape (`aspect` = width / height). When even the smallest
 * allowed card can't fit every student on one screen, the grid keeps the minimum size and
 * the board scrolls.
 */
export function fitGrid({
  count,
  width,
  height,
  gap = 12,
  minWidth = 132,
  minHeight = 96,
  maxHeight = 360,
  aspect = 1.2,
}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (!n || !w || !h) return { columns: 1, rowHeight: minHeight, fits: false };

  let best = null;
  for (let columns = 1; columns <= n; columns += 1) {
    const cardWidth = (w - gap * (columns - 1)) / columns;
    if (cardWidth < minWidth) break;
    const rows = Math.ceil(n / columns);
    const cardHeight = (h - gap * (rows - 1)) / rows;
    if (cardHeight < minHeight) continue;
    const score = Math.min(cardWidth, cardHeight * aspect);
    const emptyCells = rows * columns - n;
    if (!best || score > best.score + 0.5 || (Math.abs(score - best.score) <= 0.5 && emptyCells < best.emptyCells)) {
      best = { columns, cardHeight, score, emptyCells };
    }
  }

  if (best) {
    return {
      columns: best.columns,
      rowHeight: Math.floor(Math.min(best.cardHeight, maxHeight)),
      fits: true,
    };
  }

  const columns = Math.max(1, Math.min(n, Math.floor((w + gap) / (minWidth + gap))));
  return { columns, rowHeight: minHeight, fits: false };
}
