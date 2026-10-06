const OVERLAY_ID = 'tuit-overlay-root';

/** Sibling of #root — never inside .iboard-teacher-canvas or a scrollport. */
export function getOverlayRoot() {
  if (typeof document === 'undefined') return null;
  let node = document.getElementById(OVERLAY_ID);
  if (node) return node;
  node = document.createElement('div');
  node.id = OVERLAY_ID;
  document.body.appendChild(node);
  return node;
}
