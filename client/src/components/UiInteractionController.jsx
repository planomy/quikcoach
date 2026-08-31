import { useEffect } from 'react';

function isFloatingDetails(details) {
  if (!(details instanceof HTMLDetailsElement)) return false;
  return !!details.querySelector('[class*="absolute"]');
}

function supportNav() {
  return document.querySelector('nav[aria-label="Student tools"]');
}

function supportButtons() {
  const nav = supportNav();
  return nav ? [...nav.querySelectorAll(':scope > button')] : [];
}

function buttonLabel(button) {
  if (!(button instanceof HTMLButtonElement)) return '';
  const text = [...button.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || '')
    .join(' ')
    .trim();
  if (text) return text;
  const full = button.textContent?.trim() || '';
  return full.replace(/\s*[●\d+]+\s*$/, '').trim();
}

function buttonFor(label) {
  return supportButtons().find((button) => buttonLabel(button) === label) || null;
}

function activeSupportLabel() {
  const active = supportButtons().find((button) => button.className.includes('bg-indigo-600'));
  return buttonLabel(active);
}

function styleAttentionBadge(button, label) {
  const spans = [...button.querySelectorAll('span')];
  const badge = spans.find((span) => {
    const text = span.textContent?.trim() || '';
    return text === '●' || /^\d+$/.test(text) || /^\d+\+$/.test(text);
  });
  if (!badge) return;

  let raw = badge.textContent?.trim() || '';
  if (label === 'Respond' && raw === '●') raw = '1';
  const numeric = Number.parseInt(raw, 10);
  const display = Number.isFinite(numeric) && numeric > 9 ? '9+' : raw;
  if (!display) return;

  const ariaLabel = `${label}, ${display} new`;
  if (
    badge.dataset.iboardAttentionBadge === 'true'
    && badge.textContent === display
    && button.getAttribute('aria-label') === ariaLabel
  ) {
    return;
  }

  badge.textContent = display;
  badge.dataset.iboardAttentionBadge = 'true';
  button.style.position = 'relative';
  Object.assign(badge.style, {
    position: 'absolute',
    top: '-7px',
    right: '-7px',
    display: 'grid',
    placeItems: 'center',
    minWidth: '19px',
    height: '19px',
    padding: '0 5px',
    borderRadius: '9999px',
    background: '#dc2626',
    color: '#ffffff',
    border: '2px solid #ffffff',
    fontSize: '10px',
    fontWeight: '900',
    lineHeight: '1',
    zIndex: '4',
  });
  button.setAttribute('aria-label', ariaLabel);
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

    if (window.location.pathname !== '/student') {
      return () => {
        document.removeEventListener('pointerdown', closeFloatingMenus, true);
        document.removeEventListener('keydown', onKeyDown);
      };
    }

    let initialised = false;
    let restoreQueued = false;
    let recentUserTabChoiceUntil = 0;
    let preferredTab = 'Inbox';

    const applyStudentRail = () => {
      const nav = supportNav();
      if (!nav) return;

      const respond = buttonFor('Respond');
      const inbox = buttonFor('Inbox');
      if (respond) styleAttentionBadge(respond, 'Respond');
      if (inbox) styleAttentionBadge(inbox, 'Inbox');

      if (!initialised) {
        initialised = true;
        const inboxButton = buttonFor('Inbox');
        if (inboxButton && activeSupportLabel() !== 'Inbox') {
          queueMicrotask(() => inboxButton.click());
        }
        return;
      }

      if (Date.now() <= recentUserTabChoiceUntil) return;
      const active = activeSupportLabel();
      if (!active || active === preferredTab || restoreQueued) return;
      const preferred = buttonFor(preferredTab);
      if (!preferred) return;

      restoreQueued = true;
      queueMicrotask(() => {
        restoreQueued = false;
        if (activeSupportLabel() !== preferredTab) preferred.click();
      });
    };

    const onStudentTabPointerDown = (event) => {
      const nav = supportNav();
      if (!nav || !(event.target instanceof Element)) return;
      const button = event.target.closest('button');
      if (!button || !nav.contains(button)) return;
      const label = buttonLabel(button);
      if (!['Ask a Question', 'Respond', 'Inbox'].includes(label)) return;
      preferredTab = label;
      recentUserTabChoiceUntil = Date.now() + 500;
    };

    document.addEventListener('pointerdown', onStudentTabPointerDown, true);
    const observer = new MutationObserver(applyStudentRail);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    applyStudentRail();

    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', onStudentTabPointerDown, true);
      document.removeEventListener('pointerdown', closeFloatingMenus, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return null;
}
