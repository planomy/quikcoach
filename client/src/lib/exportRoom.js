import { wordCount } from './text.js';

function csvCell(s) {
  const x = String(s ?? '');
  if (/[",\n\r]/.test(x)) return `"${x.replace(/"/g, '""')}"`;
  return x;
}

/** One row per student; UTF-8 CSV suitable for spreadsheets. */
export function buildRoomCsv(students) {
  const header = ['id', 'name', 'class_group', 'word_count', 'updated_at', 'text'];
  const lines = [header.join(',')];
  for (const s of students) {
    lines.push(
      [
        csvCell(s.id),
        csvCell(s.name),
        csvCell(s.class_group || ''),
        csvCell(wordCount(s.text)),
        csvCell(s.updated_at),
        csvCell(s.text || ''),
      ].join(',')
    );
  }
  return lines.join('\n');
}

export function downloadTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
