import { useEffect } from 'react';

export default function AskTabLabelController() {
  useEffect(() => {
    let frame = 0;

    const relabel = () => {
      const nav = document.querySelector('nav[aria-label="Ask pages"]');
      if (!nav) return;
      for (const button of nav.querySelectorAll('button')) {
        const text = button.textContent?.trim();
        if (text === 'Quick Question') button.textContent = 'Ask Aloud';
        if (text === 'Custom Question') button.textContent = 'Send Question';
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        relabel();
      });
    };

    relabel();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
