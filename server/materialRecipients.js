// Inbox files sent to chosen students carry `studentIds`; files without it go to
// everyone in the room (including students who join later).

export function normalizeRecipientIds(raw, rosterIds) {
  if (raw == null) return null;
  const roster = new Set((rosterIds || []).map(Number).filter((id) => id > 0));
  const seen = new Set();
  for (const value of Array.isArray(raw) ? raw : []) {
    const id = Number(value);
    if (id > 0 && roster.has(id)) seen.add(id);
  }
  return [...seen];
}

export function isTargetedMaterial(item) {
  return Array.isArray(item?.studentIds);
}

export function materialVisibleTo(item, studentId) {
  if (!isTargetedMaterial(item)) return true;
  return item.studentIds.includes(Number(studentId));
}

export function materialHistoryForStudent(history, studentId) {
  return (history || [])
    .filter((item) => materialVisibleTo(item, studentId))
    .map(({ studentIds, ...item }) => item);
}
