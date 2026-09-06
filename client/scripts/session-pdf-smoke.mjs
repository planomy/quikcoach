import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSessionPdf, reportStudents, reconstructTrail } from '../src/lib/sessionPdf.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2];
if (!output) throw new Error('Provide a temporary output directory for PDF layout checks.');
fs.mkdirSync(output, { recursive: true });
const fontData = fs.readFileSync(path.join(root, 'client/public/fonts/DejaVuSans.ttf')).toString('base64');
const at = Date.parse('2026-09-06T00:00:00Z');
const opening = 'The character changes her mind.';
const addition = ' Her decision to return shows that loyalty matters more than pride.';
const events = [
  { type: 'baseline', at, text: opening },
  { type: 'feedback', at: at + 60000, text: 'What evidence supports your interpretation?' },
  { type: 'change', at: at + 120000, start: opening.length, removed: 0, inserted: addition },
  { type: 'paste', at: at + 180000, start: opening.length + addition.length, removed: 0, inserted: ' “I will return,” she promises.' },
  { type: 'stop', at: at + 240000 },
  { type: 'resume', at: at + 300000, text: 'After the break, I reconsidered the evidence.' },
  { type: 'gap', at: at + 360000, text: 'After reconnecting, the student continued the draft.' },
];
const pack = {
  format: 'iboard', version: 1, sourceRoomCode: '4821', exportedAt: new Date(at + 400000).toISOString(),
  students: [
    { exportId: 's1', name: 'Zoë O’Connor', year_level: '8', class_group: 'English', text: opening + addition },
    { exportId: 's2', name: 'Student Two - Long Writing', text: 'Paragraph with evidence and interpretation. '.repeat(350) },
    { exportId: 's3', name: 'Student Three - No Trail', text: '' },
  ],
  teacherNotesByExportId: { s1: [{ text: 'PRIVATE-FEEDBACK-ZOE: Explain the connection.', createdAt: '2026-09-06 00:01:00' }] },
  annotationsByExportId: { s1: [{ quote: 'loyalty matters more than pride', note: 'Explain why.', created_at: '2026-09-06 00:02:00' }] },
  live: { lessonPulse: { questions: [{ activity_id: 'q1', prompt: 'What changed your interpretation?' }], cells: [{ activity_id: 'q1', exportStudentId: 's1', question_number: 1, value: '__iboard_unknown__', submitted_at: '2026-09-06 00:03:00' }] } },
  draftTrail: { version: 1, students: [{ exportId: 's1', name: 'Zoë O’Connor', events }, { exportId: null, name: 'Archived Learner', events: [{ type: 'baseline', at, text: 'Archived writing remains available.' }] }] },
};
assert.equal(reportStudents(pack).length, 4);
assert.equal(reconstructTrail(events)[2].after, opening + addition);
assert.equal(reconstructTrail(events)[3].before, opening + addition);
assert.throws(() => buildSessionPdf(pack, { selectedKeys: [], fontData }), /Select at least/);
for (const [name, options] of [
  ['session-summary.pdf', {}],
  ['session-selected.pdf', { selectedKeys: ['s3'] }],
  ['session-detailed.pdf', { selectedKeys: ['s1'], detailed: true }],
]) {
  const pdf = buildSessionPdf(pack, { ...options, fontData });
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  fs.writeFileSync(path.join(output, name), bytes);
  if (name === 'session-summary.pdf') {
    assert.ok(bytes.length > 1000);
  }
  console.log(`${name}: ${pdf.getNumberOfPages()} pages`);
}
