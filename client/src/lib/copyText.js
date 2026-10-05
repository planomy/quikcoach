/** Copy plain text. navigator.clipboard only exists on HTTPS/localhost, so plain-HTTP school servers need the textarea fallback. */
export async function copyText(text) {
  const value = String(text ?? '');
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const box = document.createElement('textarea');
  box.value = value;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.left = '-9999px';
  const active = document.activeElement;
  document.body.appendChild(box);
  box.select();
  box.setSelectionRange(0, value.length);
  const copied = document.execCommand('copy');
  box.remove();
  active?.focus?.({ preventScroll: true });
  if (!copied) throw new Error('Copy command failed');
}
