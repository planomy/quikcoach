import { useEffect } from 'react';

const POPOUT_SELECTOR = [
  '.iboard-tool-popover',
  '.iboard-header-dock',
  '.iboard-gauge-panel',
  '.sets-preview-flyout',
  '.iboard-chat-phone',
  '[data-iboard-popout]',
  '[role="dialog"]',
].join(',');

const HANDLE_SELECTOR = [
  '.iboard-tool-popover__head',
  '.iboard-help-panel__chrome',
  '.iboard-chat-head',
  '.preview-heading',
  '[data-popout-handle]',
].join(',');

const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, option, label, summary, [contenteditable="true"], [role="menuitem"], [role="slider"], [role="separator"], [data-dock-resize]';

function findPopout(target) {
  if (!(target instanceof Element)) return null;
  const popout = target.closest(POPOUT_SELECTOR);
  if (!popout) return null;
  if (popout.classList.contains('iboard-start-screen')) return null;
  if (popout.classList.contains('iboard-more-menu')) return null;
  if (popout.getAttribute('role') === 'menu') return null;
  if (popout.classList.contains('fixed') && popout.classList.contains('inset-0')) return null;
  const rect = popout.getBoundingClientRect();
  if (rect.width >= window.innerWidth * 0.96 && rect.height >= window.innerHeight * 0.96) return null;
  return popout;
}

function isHandle(event, popout) {
  const target = event.target;
  if (!(target instanceof Element) || !popout.contains(target)) return false;
  if (target.closest(INTERACTIVE_SELECTOR)) return false;
  if (target.closest(HANDLE_SELECTOR)) return true;
  const heading = target.closest('h1, h2, h3, h4');
  if (heading && popout.contains(heading)) {
    const top = heading.getBoundingClientRect().top - popout.getBoundingClientRect().top;
    if (top >= 0 && top < 96) return true;
  }
  const y = event.clientY - popout.getBoundingClientRect().top;
  return y >= 0 && y <= 48;
}

export default function PopoutDrag() {
  useEffect(() => {
    const offsets = new Map();
    let seq = 0;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-popout-drag', '');
    document.head.appendChild(styleEl);

    function paint() {
      const lines = [];
      for (const [id, offset] of offsets) {
        if (!document.querySelector(`[data-popout-drag-id="${id}"]`)) {
          offsets.delete(id);
          continue;
        }
        lines.push(`[data-popout-drag-id="${id}"]{translate:${offset.x}px ${offset.y}px !important}`);
      }
      styleEl.textContent = lines.join('\n');
    }

    let drag = null;

    function onPointerDown(event) {
      if (event.button != null && event.button !== 0) return;
      if (drag) return;
      const popout = findPopout(event.target);
      if (!popout || !isHandle(event, popout)) return;
      event.preventDefault();
      if (!popout.dataset.popoutDragId) {
        seq += 1;
        popout.dataset.popoutDragId = `p${seq}`;
      }
      const id = popout.dataset.popoutDragId;
      const current = offsets.get(id) || { x: 0, y: 0 };
      drag = {
        id,
        popout,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: current.x,
        originY: current.y,
        baseLeft: popout.getBoundingClientRect().left - current.x,
        baseTop: popout.getBoundingClientRect().top - current.y,
        width: popout.getBoundingClientRect().width,
      };
      document.documentElement.classList.add('iboard-popout-dragging');
      try {
        popout.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic or already-released pointers still move through the window listener. */
      }
    }

    function onPointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const width = drag.width;
      const nextX = drag.originX + (event.clientX - drag.startX);
      const nextY = drag.originY + (event.clientY - drag.startY);
      const margin = 56;
      const left = Math.min(window.innerWidth - margin, Math.max(margin - width, drag.baseLeft + nextX));
      const top = Math.min(window.innerHeight - margin, Math.max(8, drag.baseTop + nextY));
      offsets.set(drag.id, {
        x: Math.round(left - drag.baseLeft),
        y: Math.round(top - drag.baseTop),
      });
      paint();
    }

    function endDrag(event) {
      if (!drag) return;
      if (event && event.pointerId != null && event.pointerId !== drag.pointerId) return;
      drag = null;
      document.documentElement.classList.remove('iboard-popout-dragging');
      paint();
    }

    function onPointerOver(event) {
      const popout = findPopout(event.target);
      document.documentElement.classList.toggle('iboard-popout-can-drag', Boolean(popout && isHandle(event, popout)));
    }

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointerover', onPointerOver, true);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('pointerover', onPointerOver, true);
      document.documentElement.classList.remove('iboard-popout-dragging', 'iboard-popout-can-drag');
      styleEl.remove();
    };
  }, []);

  return null;
}
