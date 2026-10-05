const SUPPORT_NOUNS = {
  comment: 'inline comment',
  note: 'note',
  chat: 'chat message',
  set: 'question set',
  thinking: 'Thinking prompt',
  ai: 'AI-assisted note',
  resource: 'resource',
  shared: 'shared writing',
};

function clock(ms) {
  return ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

function plural(noun, n) {
  if (n === 1) return `1 ${noun}`;
  if (noun === 'piece of feedback') return `${n} pieces of feedback`;
  if (noun === 'shared writing') return `${n} shared writings`;
  return `${n} ${noun}s`;
}

/** Independent-writing windows that overlap a student's trail, with the support recorded inside each. */
export function independentWindowsFor(windows, events, joinedAt, now = Date.now()) {
  const list = Array.isArray(events) ? events : [];
  const from = Number(list[0]?.at) || Number(joinedAt) || 0;
  return (Array.isArray(windows) ? windows : [])
    .filter((w) => w?.start && (w.end || now) >= from)
    .map((w) => {
      const end = w.end || now;
      const counts = {};
      for (const e of list) {
        if (e.type !== 'feedback' || e.at < w.start || e.at > end) continue;
        const noun = SUPPORT_NOUNS[e.via] || 'piece of feedback';
        counts[noun] = (counts[noun] || 0) + 1;
      }
      const parts = Object.entries(counts).map(([noun, n]) => plural(noun, n));
      const support = parts.length
        ? `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]} sent during independent writing`
        : 'No teacher support recorded';
      return { start: w.start, end: w.end, supported: parts.length > 0, range: `${clock(w.start)}–${w.end ? clock(w.end) : 'now'}`, support };
    });
}
