const STORAGE_KEY = 'iboard-student-inbox-share';

export const INBOX_SHARE_MIN = 0.28;
export const INBOX_SHARE_MAX = 0.72;
/** Matches the old 3fr writing / 2fr Inbox split. */
export const INBOX_SHARE_DEFAULT = 0.4;

export function clampInboxShare(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return INBOX_SHARE_DEFAULT;
  const clamped = Math.min(INBOX_SHARE_MAX, Math.max(INBOX_SHARE_MIN, n));
  return Math.round(clamped * 100) / 100;
}

export function readInboxShare() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === '') return INBOX_SHARE_DEFAULT;
    return clampInboxShare(raw);
  } catch {
    return INBOX_SHARE_DEFAULT;
  }
}

export function persistInboxShare(value) {
  const next = clampInboxShare(value);
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}
