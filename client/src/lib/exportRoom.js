import { wordCount } from './text.js';

function csvCell(s) {
  const x = String(s ?? '');
  if (/[",\n\r]/.test(x)) return `"${x.replace(/"/g, '""')}"`;
  return x;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stampForFilename(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function safeFilePart(s) {
  return String(s || 'student')
    .trim()
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40) || 'student';
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

/** Printable HTML evidence pack for portfolios / parent interviews / moderation. */
export function buildEvidenceHtml({
  roomCode,
  label,
  savedAt,
  students,
  modeLabel = '',
  yearLabel = '',
  subjectLabel = '',
  origin = '',
}) {
  const when = savedAt || new Date().toISOString();
  const list = students || [];
  const base = String(origin || '').replace(/\/$/, '');
  const absUrl = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
  };
  const cards = list
    .map((s, i) => {
      const text = String(s.text || '').trim();
      const group = String(s.class_group || '').trim();
      const img = absUrl(s.image_url);
      const bodyParts = [];
      if (img) {
        bodyParts.push(
          `<img class="evidence-img" src="${escapeHtml(img)}" alt="" />`
        );
      }
      if (text) {
        bodyParts.push(`<div class="body">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`);
      } else if (!img) {
        bodyParts.push(`<div class="body"><em>No writing submitted.</em></div>`);
      }
      return `<section class="card">
  <header>
    <h2>${i + 1}. ${escapeHtml(s.name || 'Student')}</h2>
    <p class="meta">ID #${escapeHtml(s.id)} · ${wordCount(s.text)} words${
        group ? ` · Group ${escapeHtml(group)}` : ''
      }${s.updated_at ? ` · Updated ${escapeHtml(s.updated_at)}` : ''}${
        img ? ' · Image attached' : ''
      }</p>
  </header>
  ${bodyParts.join('\n  ')}
</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>iBOARD — Room ${escapeHtml(roomCode)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: Georgia, "Times New Roman", serif; margin: 0; color: #1a1a1a; background: #f7f5f0; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 1.6rem; margin: 0 0 6px; }
  .sub { color: #555; font-size: 0.95rem; margin: 0 0 8px; line-height: 1.4; }
  .badge { display: inline-block; background: #e8eefc; color: #243b6b; font-family: system-ui, sans-serif;
    font-size: 0.75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    padding: 4px 10px; border-radius: 999px; margin-bottom: 18px; }
  .card { background: #fff; border: 1px solid #ddd6c8; border-radius: 12px; padding: 18px 20px; margin: 16px 0;
    break-inside: avoid; page-break-inside: avoid; }
  .card h2 { font-size: 1.15rem; margin: 0 0 4px; }
  .meta { font-family: system-ui, sans-serif; font-size: 0.8rem; color: #666; margin: 0 0 12px; }
  .body { font-size: 1rem; line-height: 1.55; white-space: normal; }
  .evidence-img { display: block; max-width: 100%; max-height: 420px; margin: 0 auto 12px; object-fit: contain; }
  footer { margin-top: 28px; font-family: system-ui, sans-serif; font-size: 0.75rem; color: #888; }
  @media print {
    body { background: #fff; }
    .wrap { padding: 0; max-width: none; }
    .card { border-color: #ccc; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <span class="badge">iBOARD</span>
  <h1>${escapeHtml(label || 'Student writing')}</h1>
  <p class="sub">Room <strong>${escapeHtml(roomCode)}</strong> · ${escapeHtml(when)}
  · ${list.length} student${list.length === 1 ? '' : 's'}
  ${modeLabel ? ` · ${escapeHtml(modeLabel)}` : ''}
  ${subjectLabel ? ` · ${escapeHtml(subjectLabel)}` : ''}
  ${yearLabel ? ` · Year ${escapeHtml(yearLabel)}` : ''}</p>
  ${cards || '<p>No student writing yet.</p>'}
  <footer>iBOARD</footer>
</div>
</body>
</html>`;
}

export function evidenceFilenames(roomCode, label) {
  const stamp = stampForFilename();
  const lab = safeFilePart(label || 'evidence');
  const base = `iboard-evidence-room${roomCode}-${lab}-${stamp}`;
  return {
    html: `${base}.html`,
    csv: `${base}.csv`,
    json: `${base}.json`,
    studentTxt: (name, id) =>
      `iboard-${safeFilePart(name)}-${id || 'x'}-${stamp}.txt`,
  };
}

export function buildStudentEvidenceText({ roomCode, student, label, savedAt }) {
  const when = savedAt || new Date().toISOString();
  const s = student || {};
  return [
    'iBOARD — Evidence of learning',
    `Room: ${roomCode}`,
    label ? `Label: ${label}` : null,
    `Saved: ${when}`,
    `Student: ${s.name || ''}`,
    `ID: ${s.id ?? ''}`,
    s.class_group ? `Group: ${s.class_group}` : null,
    `Words: ${wordCount(s.text)}`,
    s.updated_at ? `Last updated: ${s.updated_at}` : null,
    '',
    '----- Draft -----',
    String(s.text || '').trim() || '(No writing submitted.)',
    '',
  ]
    .filter((line) => line != null)
    .join('\n');
}

export function downloadTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export { stampForFilename, safeFilePart };
