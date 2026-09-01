/** Parse epoch ms from inbox payload (`at` or SQLite UTC `createdAt`). */
export function parseInboxAt(item) {
  const direct = Number(item?.at);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const createdAt = String(item?.createdAt || '').trim();
  if (!createdAt) return 0;

  const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? ms : 0;
}

export function formatInboxTime(at) {
  if (!Number.isFinite(Number(at)) || Number(at) <= 0) return '';
  return new Date(Number(at)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
