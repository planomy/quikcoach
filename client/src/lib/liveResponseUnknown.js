export const UNKNOWN_ANSWER = '__iboard_unknown__';

export function isUnknownAnswer(value) {
  return String(value || '') === UNKNOWN_ANSWER;
}

/** Human-readable answer text. Never shows raw set JSON. */
export function formatLiveAnswer(value) {
  if (isUnknownAnswer(value)) return "I don't know";
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const answers = Object.values(value).map((item) => String(item ?? '').trim()).filter(Boolean);
    return answers.length ? answers.join(' · ') : '';
  }
  const raw = String(value || '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.includes('":')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const answers = Object.values(parsed).map((item) => String(item ?? '').trim()).filter(Boolean);
        if (answers.length) return answers.join(' · ');
      }
    } catch {
      /* not JSON — fall through */
    }
  }
  return raw;
}
