/** Subscribe to layout changes that affect fixed-position overlays (scroll, resize, pinch zoom). */
export function subscribeViewportChanges(callback) {
  if (typeof window === 'undefined') return () => {};
  const schedule = () => requestAnimationFrame(callback);
  const scrollOptions = { capture: true, passive: true };
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, scrollOptions);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  return () => {
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, scrollOptions);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  };
}

export function viewportBox() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) {
    return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  }
  return {
    top: vv.offsetTop,
    left: vv.offsetLeft,
    width: vv.width,
    height: vv.height,
  };
}

/** Client pixels per layout/offset pixel. Safari pinch-zoom inflates getBoundingClientRect. */
export function clientLayoutScale(el) {
  if (!el) return 1;
  const layout = el.offsetWidth || el.offsetHeight;
  if (!layout) return 1;
  const rect = el.getBoundingClientRect();
  const client = el.offsetWidth ? rect.width : rect.height;
  const scale = client / layout;
  return Number.isFinite(scale) && scale > 0.05 ? scale : 1;
}

/** Map a client rect into an element's padding-box, undoing pinch-zoom scale. */
export function rectRelativeToElement(el, clientRect) {
  const box = el.getBoundingClientRect();
  const scale = clientLayoutScale(el);
  return {
    top: (clientRect.top - box.top) / scale,
    left: (clientRect.left - box.left) / scale,
    right: (clientRect.right - box.left) / scale,
    bottom: (clientRect.bottom - box.top) / scale,
    width: clientRect.width / scale,
    height: clientRect.height / scale,
  };
}
