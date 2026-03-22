export function wordCount(s) {
  const t = String(s || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/**
 * Keep only the first `maxWords` whitespace-separated words (matches server save rule).
 * If within limit, returns the original string (spacing preserved).
 */
export function truncateToWordLimit(text, maxWords) {
  const s = String(text ?? '');
  if (!maxWords || maxWords <= 0) return s;
  const parts = s.trim() ? s.trim().split(/\s+/).filter(Boolean) : [];
  if (parts.length <= maxWords) return s;
  return parts.slice(0, maxWords).join(' ');
}

/**
 * Soft band around the teacher’s word target for student guidance (when not enforcing).
 * @param {number} wordTarget — room word target (0 = unset)
 * @returns {{ low: number, high: number } | null}
 */
export function recommendedWordRange(wordTarget) {
  const t = Number(wordTarget);
  if (!t || t <= 0) return null;
  const low = Math.max(15, Math.round(t * 0.65));
  const high = Math.round(t * 1.35);
  return { low, high: Math.max(low + 5, high) };
}

/** Activity dot: `live` (recent save), `warm`, or `idle`. */
export function activityStatus(updatedAt) {
  if (!updatedAt) return 'idle';
  const ms = new Date(updatedAt).getTime();
  if (Number.isNaN(ms)) return 'idle';
  const sec = (Date.now() - ms) / 1000;
  if (sec < 20) return 'live';
  if (sec < 120) return 'warm';
  return 'idle';
}
