import { useEffect } from 'react';

function isFloatingDetails(details) {
  if (!(details instanceof HTMLDetailsElement)) return false;
  return !!details.querySelector('[class*="absolute"]');
}

export default function UiInteractionController() {
  useEffect(() => {
    const closeFloatingMenus = (event) => {
      for (const details of document.querySelectorAll('details[open]')) {
        if (!isFloatingDetails(details)) continue;
        if (event?.target instanceof Node && details.contains(event.target)) continue;
        details.open = false;
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeFloatingMenus();
    };

    document.addEventListener('pointerdown', closeFloatingMenus, true);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', closeFloatingMenus, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return null;
}
