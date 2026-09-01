import { LIVE_STATUS_LABELS } from './liveResponseMeta.js';
import { downloadTextFile, stampForFilename } from './exportRoom.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function truncate(text, max = 48) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function confidenceLabel(confidence) {
  if (confidence === 'confident') return 'Confident';
  if (confidence === 'unsure') return 'Not sure';
  if (confidence === 'guessed') return 'Guessed';
  return '';
}

function statusLabel(status) {
  if (!status) return '';
  return LIVE_STATUS_LABELS[status] || status;
}

function cellForStudent(report, studentId, questionNumber) {
  const student = report.students.find((row) => row.id === studentId);
  const cell = student?.cells?.find((row) => row.questionNumber === questionNumber);
  if (!cell) return '—';
  const conf = confidenceLabel(cell.confidence);
  const answer = truncate(cell.value, 24);
  return conf ? `${answer} (${conf})` : answer;
}

export function buildLessonReportHtml(report) {
  const when = report.generatedAt ? new Date(report.generatedAt).toLocaleString() : new Date().toLocaleString();
  const questions = report.questions || [];
  const students = report.students || [];

  const byQuestionRows = questions.map((question) => `
    <tr>
      <td>Q${question.questionNumber}</td>
      <td>${escapeHtml(truncate(question.prompt, 80))}</td>
      <td>${question.responded}/${question.roster}</td>
      <td>${question.responseRate}%</td>
      <td>${question.confident}</td>
      <td>${question.unsure}</td>
      <td>${question.guessed}</td>
    </tr>
  `).join('');

  const studentHeader = questions.map((q) => `<th>Q${q.questionNumber}</th>`).join('');
  const byStudentRows = students.map((student) => `
    <tr>
      <td>${escapeHtml(student.name)}</td>
      <td>${student.pulseAnswered}/${student.pulseOpportunities || '—'}</td>
      <td>${student.pulseParticipation}%</td>
      <td>${escapeHtml(statusLabel(student.engagementStatus) || '—')}</td>
      <td>${student.questionsAsked || 0}</td>
      ${questions.map((q) => `<td>${escapeHtml(cellForStudent(report, student.id, q.questionNumber))}</td>`).join('')}
    </tr>
  `).join('');

  const qnaBlock = (report.qna || []).length
    ? `<section><h2>Student questions</h2><ul>${report.qna.map((q) => `
        <li><strong>${q.anonymous ? 'Anonymous' : escapeHtml(q.studentName)}</strong> · ${escapeHtml(q.status)} — ${escapeHtml(truncate(q.text, 120))}</li>
      `).join('')}</ul></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iBOARD lesson report · Room ${escapeHtml(report.roomCode)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 980px; margin: 2rem auto; padding: 0 1rem; color: #0f172a; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.35rem; }
    .meta { color: #64748b; font-size: 0.9rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.75rem; }
    th, td { border: 1px solid #e2e8f0; padding: 0.45rem 0.55rem; text-align: left; vertical-align: top; }
    th { background: #f8fafc; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
    ul { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>Lesson report · Room ${escapeHtml(report.roomCode)}</h1>
  <p class="meta">Generated ${escapeHtml(when)} · ${students.length} participant${students.length === 1 ? '' : 's'} · ${questions.length} pulse question${questions.length === 1 ? '' : 's'}</p>

  <section>
    <h2>By question — did the prompts work?</h2>
    <table>
      <thead><tr><th>Q</th><th>Prompt</th><th>Answered</th><th>Rate</th><th>Confident</th><th>Not sure</th><th>Guessed</th></tr></thead>
      <tbody>${byQuestionRows || '<tr><td colspan="7">No pulse questions yet.</td></tr>'}</tbody>
    </table>
  </section>

  <section>
    <h2>By student — who participated?</h2>
    <table>
      <thead><tr><th>Student</th><th>Pulse</th><th>Rate</th><th>Status</th><th>Asked</th>${studentHeader}</tr></thead>
      <tbody>${byStudentRows || '<tr><td colspan="5">No participants yet.</td></tr>'}</tbody>
    </table>
  </section>

  ${qnaBlock}
</body>
</html>`;
}

export function buildLessonReportCsv(report) {
  const questions = report.questions || [];
  const students = report.students || [];
  const lines = [];

  lines.push(['Section', 'Question', 'Prompt', 'Answered', 'Roster', 'Rate %', 'Confident', 'Not sure', 'Guessed'].map(csvCell).join(','));
  for (const question of questions) {
    lines.push([
      'By question',
      `Q${question.questionNumber}`,
      question.prompt,
      question.responded,
      question.roster,
      question.responseRate,
      question.confident,
      question.unsure,
      question.guessed,
    ].map(csvCell).join(','));
  }

  lines.push('');
  const header = ['Section', 'Student', 'Pulse answered', 'Pulse opportunities', 'Participation %', 'Status', 'Questions asked', ...questions.map((q) => `Q${q.questionNumber}`)];
  lines.push(header.map(csvCell).join(','));
  for (const student of students) {
    lines.push([
      'By student',
      student.name,
      student.pulseAnswered,
      student.pulseOpportunities,
      student.pulseParticipation,
      statusLabel(student.engagementStatus) || '',
      student.questionsAsked,
      ...questions.map((q) => cellForStudent(report, student.id, q.questionNumber)),
    ].map(csvCell).join(','));
  }

  return `\uFEFF${lines.join('\r\n')}`;
}

export function downloadLessonReportHtml(report) {
  const stamp = stampForFilename(new Date(report.generatedAt || Date.now()));
  downloadTextFile(`iboard-lesson-${report.roomCode}-${stamp}.html`, buildLessonReportHtml(report), 'text/html;charset=utf-8');
}

export function downloadLessonReportCsv(report) {
  const stamp = stampForFilename(new Date(report.generatedAt || Date.now()));
  downloadTextFile(`iboard-lesson-${report.roomCode}-${stamp}.csv`, buildLessonReportCsv(report), 'text/csv;charset=utf-8');
}
