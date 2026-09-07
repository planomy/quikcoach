import test from 'node:test';
import assert from 'node:assert/strict';
import { setTrailRecording, recordTrailText, trailTick, readTrail, exportTrails, importTrails, validateTrails, clearTrail, recordTrailFeedback, disconnectTrail, textDelta, trailStatus, studentTrailAttention } from './draftTrail.js';

test('compact delta reconstructs insertion, deletion, replacement and Unicode', () => {
  for (const [before, after] of [['abc', 'axbc'], ['abc', 'ac'], ['', 'Hi 👋'], ['Hi 👋', 'Hello 🌏'], ['abc', ''], ['same', 'same']]) {
    const d = textDelta(before, after);
    assert.equal(before.slice(0, d.start) + d.inserted + before.slice(d.start + d.removed), after);
  }
});
test('off, pause, paste, feedback, reconnect, export/import and invalid packs', () => {
  const row = { id: 1, name: 'Mia', text: 'Opening' };
  recordTrailText('1100', row, 'not recorded');
  assert.equal(readTrail('1100', 1), null);
  const { token } = setTrailRecording('1100', true, [row], 1000, { label: 'Period 3' });
  assert.equal(trailStatus('1100').label, 'Period 3');
  recordTrailText('1100', row, 'Opening argument', { token }, 2000);
  recordTrailFeedback('1100', row, 'Add evidence', 3000);
  recordTrailText('1100', row, 'Opening argument with evidence', { token, paste: true }, 4000);
  setTrailRecording('1100', false, [row], 5000);
  row.text = 'Unrecorded work';
  recordTrailText('1100', row, 'do not capture', { token }, 6000);
  const resumed = setTrailRecording('1100', true, [row], 7000);
  disconnectTrail('1100', 1);
  recordTrailText('1100', row, 'After reconnect', { token: resumed.token }, 8000);
  const trail = readTrail('1100', 1);
  assert.deepEqual(trail.events.map(e => e.type), ['baseline', 'change', 'feedback', 'paste', 'stop', 'resume', 'gap']);
  assert.equal(trail.events.at(-1).text, 'After reconnect');
  assert.equal(trailStatus('1100').label, 'Period 3');
  const packed = exportTrails('1100', new Map([[1, 's1']]));
  assert.equal(packed.label, 'Period 3');
  validateTrails(packed);
  importTrails('2200', packed, new Map([['s1', 42]]));
  assert.equal(trailStatus('2200').active, false);
  assert.equal(trailStatus('2200').label, 'Period 3');
  assert.deepEqual(readTrail('2200', 42).events, packed.students[0].events);
  assert.equal(readTrail('2200', 42).name, 'Mia');
  assert.throws(() => validateTrails({ version: 1, students: [{ events: [{ type: 'change', at: 1, start: 100, removed: 0, inserted: '' }] }] }));
  clearTrail('1100'); clearTrail('2200');
});
test('attention flags large paste and clears for quiet typing', () => {
  const row = { id: 7, name: 'Alex', text: 'Start' };
  const { token } = setTrailRecording('4400', true, [row], 1000);
  assert.equal(trailStatus('4400').attentionIds.includes(7), false);
  const pasted = `Start ${'x'.repeat(130)}`;
  recordTrailText('4400', row, pasted, { token, paste: true }, 2000);
  const trail = readTrail('4400', 7);
  assert.equal(studentTrailAttention(trail), true);
  assert.ok(trailStatus('4400').attentionIds.includes(7));
  clearTrail('4400');
});
test('45-minute simulated class of 30 retains small checkpoints and final text', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Student ${i + 1}`, text: '' }));
  const { token } = setTrailRecording('3300', true, rows, 100000);
  for (let tick = 1; tick <= 540; tick++) {
    for (const row of rows) {
      const next = row.text + ` word${tick}`;
      recordTrailText('3300', row, next, { token }, 100000 + tick * 5000);
      row.text = next;
    }
    trailTick(100000 + tick * 5000);
  }
  setTrailRecording('3300', false, rows, 2800000);
  const pack = exportTrails('3300', new Map(rows.map(r => [r.id, `s${r.id}`])));
  validateTrails(pack);
  for (const student of pack.students) {
    let text = '';
    for (const e of student.events) {
      if (e.type === 'baseline') text = e.text;
      if (e.type === 'change') text = text.slice(0, e.start) + e.inserted + text.slice(e.start + e.removed);
    }
    assert.equal(text, rows.find(r => r.name === student.name).text);
    assert.ok(student.events.length < 100);
  }
  const bytes = Buffer.byteLength(JSON.stringify(pack));
  assert.ok(bytes < 500000);
  console.log(`30 students, 45 simulated minutes: ${bytes} bytes total`);
  clearTrail('3300');
});
