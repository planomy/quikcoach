// Anonymised Class insights export: class-level only, no names, no draft text,
// and any count from 1 to 4 is hidden so small groups can't be singled out.

export const SMALL_COUNT = 5;

export function suppressCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n > 0 && n < SMALL_COUNT ? '<5' : String(Math.round(n));
}

function suppressPct(part, whole) {
  if (!(whole >= SMALL_COUNT) || part == null) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function formatMinutes(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '—';
  const m = Number(minutes);
  if (m < 1) return '<1 min';
  if (m < 90) return `${Math.round(m)} min`;
  return `${round1(m / 60)} h`;
}

export function formatLessonDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function weightedAverage(pairs) {
  let sum = 0;
  let weight = 0;
  for (const [value, w] of pairs) {
    if (value == null || !(w > 0)) continue;
    sum += value * w;
    weight += w;
  }
  return weight ? sum / weight : null;
}

/** Headline numbers across a set of lesson summaries (newest-first or any order). */
export function headlineTotals(lessons = []) {
  const commentsGiven = lessons.reduce((n, l) => n + (l.commentsGiven || 0), 0);
  const actedOn = lessons.reduce((n, l) => n + (l.actedOn || 0), 0);
  const checkAgain = lessons.reduce((n, l) => n + (l.checkAgain || 0), 0);
  const pastes = lessons.reduce((n, l) => n + (l.pastes || 0), 0);
  const revise = weightedAverage(lessons.map((l) => [l.avgReviseMinutes, l.revised]));
  const confirm = weightedAverage(lessons.map((l) => [l.avgConfirmMinutes, l.confirmed]));
  const words = weightedAverage(lessons.map((l) => [l.avgWords, l.students]));
  const writing = weightedAverage(lessons.map((l) => [l.writingPct, l.writingSamples]));
  return {
    lessons: lessons.length,
    commentsGiven,
    actedOn,
    actedOnPct: commentsGiven ? Math.round((actedOn / commentsGiven) * 100) : null,
    checkAgain,
    checkAgainPct: commentsGiven ? Math.round((checkAgain / commentsGiven) * 100) : null,
    avgReviseMinutes: revise == null ? null : round1(revise),
    avgConfirmMinutes: confirm == null ? null : round1(confirm),
    pastes,
    pastesPerLesson: lessons.length ? round1(pastes / lessons.length) : null,
    avgWords: words == null ? null : Math.round(words),
    writingPct: writing == null ? null : Math.round(writing),
  };
}

/** Oldest first, labelled Lesson 1…n; rooms become Group 1…n so codes aren't exported. */
export function anonymisedRows(lessons = []) {
  const ordered = [...lessons].sort((a, b) => a.startedAt - b.startedAt);
  const groups = new Map();
  for (const lesson of ordered) {
    if (!groups.has(lesson.roomCode)) groups.set(lesson.roomCode, `Group ${groups.size + 1}`);
  }
  const multiGroup = groups.size > 1;
  return ordered.map((lesson, index) => {
    const smallClass = !(lesson.students >= SMALL_COUNT);
    return {
      lesson: `Lesson ${index + 1}`,
      group: multiGroup ? groups.get(lesson.roomCode) : '',
      date: lesson.startedAt ? new Date(lesson.startedAt).toISOString().slice(0, 10) : '',
      students: suppressCount(lesson.students),
      commentsGiven: suppressCount(lesson.commentsGiven),
      actedOn: suppressPct(lesson.actedOn, lesson.commentsGiven),
      checkAgain: suppressPct(lesson.checkAgain, lesson.commentsGiven),
      timeToRevise: lesson.revised >= SMALL_COUNT ? formatMinutes(lesson.avgReviseMinutes) : '—',
      timeToConfirm: lesson.confirmed >= SMALL_COUNT ? formatMinutes(lesson.avgConfirmMinutes) : '—',
      pastes: suppressCount(lesson.pastes),
      studentsPasted: suppressCount(lesson.studentsPasted),
      avgWords: smallClass || lesson.avgWords == null ? '—' : String(lesson.avgWords),
      writing: smallClass || lesson.writingPct == null ? '—' : `${lesson.writingPct}%`,
    };
  });
}

export const EXPORT_COLUMNS = [
  ['lesson', 'Lesson'],
  ['group', 'Group'],
  ['date', 'Date'],
  ['students', 'Students'],
  ['commentsGiven', 'Comments given'],
  ['actedOn', 'Acted on'],
  ['checkAgain', 'Needed Check again'],
  ['timeToRevise', 'Avg time to revise'],
  ['timeToConfirm', 'Avg time to confirm'],
  ['pastes', 'Pastes'],
  ['studentsPasted', 'Students who pasted'],
  ['avgWords', 'Avg words written per student'],
  ['writing', 'Actively writing'],
];

export function exportColumns(rows) {
  return EXPORT_COLUMNS.filter(([key]) => key !== 'group' || rows.some((row) => row.group));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function insightsCsv(lessons = []) {
  const rows = anonymisedRows(lessons);
  const columns = exportColumns(rows);
  const lines = [columns.map(([, label]) => csvCell(label)).join(',')];
  for (const row of rows) lines.push(columns.map(([key]) => csvCell(row[key])).join(','));
  return `${lines.join('\n')}\n`;
}

export function downloadInsightsCsv(lessons, filename = 'class-insights-anonymised.csv') {
  const blob = new Blob([insightsCsv(lessons)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
