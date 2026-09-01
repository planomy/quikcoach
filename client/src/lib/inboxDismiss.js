const KEY_PREFIX = 'iboard-inbox-dismissed-';

function keyFor(code, studentId) {
  const c = String(code || '').replace(/\D/g, '').slice(0, 4);
  const id = Number(studentId);
  if (c.length !== 4 || !id) return '';
  return `${KEY_PREFIX}${c}-${id}`;
}

/** Item ids the student has dismissed locally (hidden from Inbox list). */
export function readDismissedInboxIds(code, studentId) {
  const key = keyFor(code, studentId);
  if (!key) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function dismissInboxItem(code, studentId, itemId) {
  const key = keyFor(code, studentId);
  if (!key || !itemId) return;
  const next = readDismissedInboxIds(code, studentId);
  next.add(String(itemId));
  try {
    localStorage.setItem(key, JSON.stringify([...next].slice(-200)));
  } catch {
    /* storage blocked */
  }
}

/** Clear locally dismissed inbox items when the teacher starts a new class. */
export function clearDismissedInboxIds(code, studentId) {
  const key = keyFor(code, studentId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}
