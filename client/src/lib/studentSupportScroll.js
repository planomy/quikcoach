/** Scroll a node inside the student Ask/Respond/Inbox rail without moving the page. */
export function scrollStudentSupportToNode(node, { behavior = 'smooth', offset = 8 } = {}) {
  if (!node || typeof document === 'undefined') return false;
  const scroller = document.querySelector('.iboard-student-support-scroll');
  if (!scroller || !scroller.contains(node)) return false;
  const scrollerRect = scroller.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const nextTop = scroller.scrollTop + (nodeRect.top - scrollerRect.top) - offset;
  scroller.scrollTo({ top: Math.max(0, nextTop), behavior });
  return true;
}

/** Prefer the support rail; fall back to nearest in-view scroll for floating Pulse docks. */
export function bringStudentPanelIntoView(node, { behavior = 'smooth', offset = 8 } = {}) {
  if (!node) return;
  if (scrollStudentSupportToNode(node, { behavior, offset })) return;
  node.scrollIntoView?.({ behavior, block: 'nearest', inline: 'nearest' });
}
