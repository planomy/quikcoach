const KEY_PREFIX = 'iboard-draft-backup-';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function keyFor(code, studentId) {
  const c = String(code || '').replace(/\D/g, '').slice(0, 4);
  const id = Number(studentId);
  if (c.length !== 4 || !id) return '';
  return `${KEY_PREFIX}${c}-${id}`;
}

/** Persist a student draft on-device (survives browser refresh; not the server). */
export function saveDraftBackup({ code, studentId, name, text, richHtml }) {
  const key = keyFor(code, studentId);
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        code: String(code).replace(/\D/g, '').slice(0, 4),
        studentId: Number(studentId),
        name: String(name || '').slice(0, 120),
        text: String(text || ''),
        richHtml: String(richHtml || ''),
        savedAt: Date.now(),
      })
    );
  } catch {
    /* storage full or blocked */
  }
}

export function readDraftBackup(code, studentId) {
  const key = keyFor(code, studentId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.savedAt && Date.now() - Number(parsed.savedAt) > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraftBackup(code, studentId) {
  const key = keyFor(code, studentId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
