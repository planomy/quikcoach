import { useEffect } from 'react';

const MENU_BUTTON_CLASS = 'w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

export default function AskTabLabelController() {
  useEffect(() => {
    let frame = 0;

    const polish = () => {
      const nav = document.querySelector('nav[aria-label="Ask pages"]');
      if (!nav) return;

      const more = nav.querySelector('details');
      const menu = more?.querySelector('div');

      for (const button of nav.querySelectorAll('button')) {
        const text = button.textContent?.trim() || '';

        if (text === 'Quick Question') {
          button.textContent = 'Ask Aloud';
          continue;
        }
        if (text === 'Custom Question') {
          button.textContent = 'Send Question';
          continue;
        }
        if (text.startsWith('Saved ·')) {
          button.textContent = text.replace('Saved ·', 'Saved Questions ·');
          continue;
        }
        if (text.startsWith('Featured ·')) {
          button.textContent = text.replace('Featured ·', 'Featured Responses ·');
          continue;
        }
        if (text === 'From students') {
          button.textContent = 'Student Questions';
          continue;
        }
        if (text.startsWith('From students ·') && menu) {
          button.textContent = text.replace('From students ·', 'Student Questions ·');
          button.className = MENU_BUTTON_CLASS;
          menu.appendChild(button);
        }
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        polish();
      });
    };

    polish();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
