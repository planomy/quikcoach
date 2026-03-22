/** Match client `wordCount` / student draft limits: whitespace-separated tokens. */
export function truncateToWordLimit(text, maxWords) {
  const s = String(text ?? '');
  if (!maxWords || maxWords <= 0) return s;
  const parts = s.trim() ? s.trim().split(/\s+/).filter(Boolean) : [];
  if (parts.length <= maxWords) return s;
  return parts.slice(0, maxWords).join(' ');
}
