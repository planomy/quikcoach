function tuneWordTargetSlider(root = document) {
  const slider = root.querySelector?.('input[type="range"][aria-label="Word target"]');
  if (!slider) return;

  slider.min = '0';
  slider.max = '500';
  slider.step = '10';
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const apply = () => tuneWordTargetSlider(document);

  queueMicrotask(apply);

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
}
