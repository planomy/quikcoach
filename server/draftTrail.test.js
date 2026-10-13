import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTrailRecording, recordTrailText, trailTick, readTrail, pastesFromTrail, exportTrails, importTrails, validateTrails, clearTrail, recordTrailFeedback, disconnectTrail, textDelta, trailStatus, studentTrailAttention, configureTrailPersistence, persistTrails, dropTrailsFromMemory, trailStrips, recordTrailPresence } from './draftTrail.js';

test('trail strips mark adding, revising, away and paste in time order', () => {
  const t0 = 1_700_000_000_000;
  const row = { id: 7, name: 'Ava', text: 'One' };
  const { token } = setTrailRecording('3399', true, [row], t0);
  recordTrailText('3399', row, 'One two', { token }, t0 + 60000);
  trailTick(t0 + 80000);
  recordTrailText('3399', row, 'Uno two', { token }, t0 + 120000);
  trailTick(t0 + 140000);
  recordTrailPresence('3399', row, true, t0 + 180000);
  recordTrailPresence('3399', row, false, t0 + 240000);
  recordTrailText('3399', row, 'Uno two pasted', { token, paste: true }, t0 + 270000);
  const strips = trailStrips('3399', t0 + 300000, { count: 5 });
  assert.equal(strips.students[0].cells, '-wraw');
  assert.equal(strips.students[0].started, t0 + 60000);
  assert.deepEqual(strips.students[0].marks.map((m) => m.k), ['paste']);
  assert.equal(strips.students[0].marks[0].at, t0 + 270000);
  clearTrail('3399');
});

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
test('paste after a drop still stores the pasted words, not a silent gap', () => {
  const row = { id: 3, name: 'Leo', text: 'Draft so far' };
  const { token } = setTrailRecording('6600', true, [row], 1000);
  recordTrailText('6600', row, 'Draft so far, typed', { token }, 2000);
  disconnectTrail('6600', 3);
  recordTrailText('6600', row, 'Draft so far, typed\n\nPasted paragraph from notes', { token: 'stale', paste: true }, 3000);
  const trail = readTrail('6600', 3);
  assert.equal(trail.events.at(-1).type, 'paste');
  assert.match(trail.events.at(-1).inserted, /Pasted paragraph/);
  assert.deepEqual(pastesFromTrail(trail).map((item) => item.text), ['Pasted paragraph from notes']);
  clearTrail('6600');
});
test('reconnect gaps of typed words are not listed as pastes', () => {
  const row = { id: 4, name: 'Nia', text: 'Start' };
  const { token } = setTrailRecording('6700', true, [row], 1000);
  recordTrailText('6700', row, 'Start evertyly', { token }, 2000);
  disconnectTrail('6700', 4);
  recordTrailText('6700', row, 'Start evertyly Ac', { token: 'stale' }, 3000);
  recordTrailText('6700', row, 'Start evertyly Ac Neutrality here is not an option', { token, paste: true }, 4000);
  const trail = readTrail('6700', 4);
  assert.deepEqual(pastesFromTrail(trail).map((item) => item.text), ['Neutrality here is not an option']);
  clearTrail('6700');
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
test('live trail survives a server restart mid-recording and marks the gap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-'));
  configureTrailPersistence(dir);
  const row = { id: 9, name: 'Sam', text: 'First' };
  const { token } = setTrailRecording('5500', true, [row], 1000, { label: 'Crash test' });
  recordTrailText('5500', row, 'First draft line', { token }, 2000);
  recordTrailText('5500', row, 'First draft line, then more', { token, paste: true }, 3000);
  persistTrails(4000, { force: true });
  assert.ok(fs.existsSync(path.join(dir, '5500.json')));

  dropTrailsFromMemory();
  assert.equal(readTrail('5500', 9), null);
  configureTrailPersistence(dir);

  assert.equal(trailStatus('5500').active, true);
  assert.equal(trailStatus('5500').label, 'Crash test');
  assert.deepEqual(readTrail('5500', 9).events.map((e) => e.type), ['baseline', 'change', 'paste']);
  recordTrailText('5500', row, 'After the restart', { token }, 5000);
  assert.equal(readTrail('5500', 9).events.at(-1).type, 'gap');

  clearTrail('5500');
  assert.equal(fs.existsSync(path.join(dir, '5500.json')), false);
  fs.rmSync(dir, { recursive: true, force: true });
  configureTrailPersistence(fs.mkdtempSync(path.join(os.tmpdir(), 'trail-keep-')));
});
test('unchanged saves and a missing token do not pile up checkpoints', () => {
  const row = { id: 4, name: 'Chip', text: 'Hi' };
  const { token } = setTrailRecording('8800', true, [row], 1000);
  recordTrailText('8800', row, 'Hi there', { token }, 2000);
  trailTick(12000);
  const before = readTrail('8800', 4).events.length;
  for (let i = 0; i < 40; i++) {
    recordTrailText('8800', row, 'Hi there', { token: '' }, 13000 + i * 1000);
    disconnectTrail('8800', 4);
    recordTrailText('8800', row, 'Hi there', { token }, 13000 + i * 1000 + 10);
  }
  assert.equal(readTrail('8800', 4).events.length, before);
  clearTrail('8800');
});
test('a dropped connection stores one snapshot then small edits', () => {
  const row = { id: 5, name: 'Ned', text: 'Start' };
  const { token } = setTrailRecording('8810', true, [row], 1000);
  let text = 'Start';
  for (let i = 0; i < 25; i++) {
    disconnectTrail('8810', 5);
    text += '!';
    recordTrailText('8810', row, text, { token: '' }, 2000 + i * 1000);
  }
  const trail = readTrail('8810', 5);
  const gaps = trail.events.filter((event) => event.type === 'gap');
  assert.equal(gaps.length, 1);
  let folded = '';
  for (const event of trail.events) {
    if (event.type === 'baseline' || event.type === 'gap' || event.type === 'resume') folded = event.text ?? folded;
    if (event.type === 'change' || event.type === 'paste') {
      folded = folded.slice(0, event.start) + event.inserted + folded.slice(event.start + event.removed);
    }
  }
  assert.equal(folded, text);
  assert.ok(trail.events.filter((event) => event.type === 'change').every((event) => event.inserted.length <= 2));
  clearTrail('8810');
});
test('one full student trail leaves the rest of the class recording', () => {
  const full = { id: 1, name: 'Full', text: '' };
  const other = { id: 2, name: 'Other', text: '' };
  const { token } = setTrailRecording('8820', true, [full, other], 1000);
  for (let i = 0; i < 2999; i++) {
    recordTrailText('8820', full, String(i), { token }, 1000 + (i + 1) * 30000);
  }
  assert.equal(readTrail('8820', 1).events.length, 3000);
  recordTrailText('8820', full, 'still going', { token }, 1000 + 3000 * 30000);
  assert.equal(readTrail('8820', 1).events.length, 3000);
  recordTrailText('8820', other, 'Class continues', { token }, 1000 + 3001 * 30000);
  assert.equal(trailStatus('8820').active, true);
  assert.equal(trailStatus('8820').reason, '');
  assert.ok(readTrail('8820', 2).events.some((event) => event.type === 'change'));
  clearTrail('8820');
});
