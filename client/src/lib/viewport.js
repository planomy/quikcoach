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
