import { jsPDF } from 'jspdf';
import { anonymisedRows, exportColumns, formatMinutes, headlineTotals, suppressCount, SMALL_COUNT } from './insightsExport.js';

const MAX_TABLE_ROWS = 16;
const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const ACCENT = [79, 70, 229];

function plain(text) {
  return String(text ?? '').replace(/—/g, '-');
}

/** One-page anonymised summary. Class-level numbers only; counts under 5 are hidden. */
export function downloadInsightsPdf(lessons = [], filename = 'class-insights-anonymised.pdf') {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 14;
  const width = pageW - margin * 2;
  let y = margin + 4;

  const ordered = [...lessons].sort((a, b) => a.startedAt - b.startedAt);
  const totals = headlineTotals(ordered);
  const first = ordered[0]?.startedAt;
  const last = ordered[ordered.length - 1]?.startedAt;
  const fmt = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(...INK);
  pdf.text('Class insights - anonymised summary', margin, y);
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...MUTED);
  pdf.text(
    first ? `${ordered.length} lesson${ordered.length === 1 ? '' : 's'} · ${fmt(first)} to ${fmt(last)}` : 'No lessons recorded',
    margin,
    y
  );
  y += 8;

  const pct = (value, whole) => (whole >= SMALL_COUNT && value != null ? `${value}%` : '-');
  const tiles = [
    ['Comments given', suppressCount(totals.commentsGiven)],
    ['Acted on', pct(totals.actedOnPct, totals.commentsGiven)],
    ['Needed Check again', pct(totals.checkAgainPct, totals.commentsGiven)],
    ['Avg time to revise', plain(formatMinutes(totals.avgReviseMinutes))],
    ['Avg time to confirm', plain(formatMinutes(totals.avgConfirmMinutes))],
    ['Pastes / lesson', totals.pastesPerLesson == null ? '-' : String(totals.pastesPerLesson)],
    ['Words written / student', totals.avgWords == null ? '-' : String(totals.avgWords)],
    ['Actively writing', totals.writingPct == null ? '-' : `${totals.writingPct}%`],
  ];
  const tileW = width / 4;
  tiles.forEach(([label, value], index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = margin + col * tileW;
    const ty = y + row * 16;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(...INK);
    pdf.text(plain(value), x, ty + 5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    pdf.text(label, x, ty + 10);
  });
  y += 36;

  const chartLessons = ordered.slice(-MAX_TABLE_ROWS);
  const chartH = 26;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...INK);
  pdf.text('Comments acted on, by lesson', margin, y);
  y += 3;
  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, y + chartH, margin + width, y + chartH);
  const slot = chartLessons.length ? width / chartLessons.length : width;
  chartLessons.forEach((lesson, index) => {
    if (!(lesson.commentsGiven >= SMALL_COUNT) || lesson.actedOnPct == null) return;
    const h = (lesson.actedOnPct / 100) * chartH;
    pdf.setFillColor(...ACCENT);
    pdf.rect(margin + index * slot + slot * 0.2, y + chartH - h, slot * 0.6, h, 'F');
  });
  y += chartH + 10;

  const rows = anonymisedRows(ordered).slice(-MAX_TABLE_ROWS);
  const columns = exportColumns(rows).filter(([key]) => key !== 'date');
  const colW = width / columns.length;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(...MUTED);
  let headerLines = 1;
  columns.forEach(([, label], index) => {
    const lines = pdf.splitTextToSize(label, colW - 2);
    headerLines = Math.max(headerLines, lines.length);
    pdf.text(lines, margin + index * colW, y);
  });
  y += headerLines * 3 + 4;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...INK);
  for (const row of rows) {
    pdf.setDrawColor(241, 245, 249);
    pdf.line(margin, y - 3.6, margin + width, y - 3.6);
    columns.forEach(([key], index) => pdf.text(plain(row[key]), margin + index * colW, y));
    y += 5.6;
  }
  if (ordered.length > MAX_TABLE_ROWS) {
    pdf.setTextColor(...MUTED);
    pdf.text(`Showing the latest ${MAX_TABLE_ROWS} lessons; the CSV has all ${ordered.length}.`, margin, y);
    y += 5;
  }

  const notes = [
    'Class-level only: no names and no student writing. Counts from 1 to 4 are shown as <5, and rates are hidden when fewer than 5 comments or students sit behind them.',
    '"Acted on" means the student revised the passage a comment pointed to - it is a sign of engagement with feedback, not proof the writing improved.',
    'Pastes count every paste into a draft, including a student moving their own text. "Actively writing" is the share of students in the room who changed their draft in each 5-minute window. Trends are observations, not causes.',
  ];
  pdf.setFontSize(7.5);
  pdf.setTextColor(...MUTED);
  let noteY = Math.max(y + 6, 262);
  for (const note of notes) {
    const lines = pdf.splitTextToSize(note, width);
    pdf.text(lines, margin, noteY);
    noteY += lines.length * 3.4 + 1;
  }

  pdf.save(filename);
}
