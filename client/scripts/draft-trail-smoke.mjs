import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

// Isolated local server and disposable data; never points at a live classroom.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const data = await mkdtemp(path.join(tmpdir(), 'iboard-draft-trail-'));
const server = spawn(process.execPath, ['--import', './richTextPatch.js', '--import', './feedbackPatch.js', '--import', './ownershipPatch.js', 'index.js'], { cwd: path.join(root, 'server'), env: { ...process.env, PORT: '3298', DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
const sockets = [];
const connect = () => { const s = io('http://127.0.0.1:3298', { transports: ['websocket'] }); sockets.push(s); return s; };
const ack = (s, event, payload = {}) => new Promise((resolve, reject) => s.timeout(10000).emit(event, payload, (err, value) => err ? reject(err) : resolve(value)));
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    server.stdout.on('data', text => { if (String(text).includes('iBOARD server')) { clearTimeout(timer); resolve(); } });
    server.stderr.on('data', text => { if (!String(text).includes('ExperimentalWarning') && !String(text).includes('trace-warnings')) process.stderr.write(text); });
  });
  const teacher = connect();
  assert.equal((await ack(teacher, 'teacher:join', { code: '9911' })).ok, true);
  const students = await Promise.all(Array.from({ length: 30 }, async (_, i) => {
    const socket = connect();
    const joined = await ack(socket, 'student:join', { code: '9911', name: `Trail Student ${i + 1}` });
    assert.equal(joined.ok, true);
    return { socket, id: joined.student.id };
  }));
  assert.equal((await ack(students[0].socket, 'teacher:draft-trail-view')).ok, false);
  assert.equal((await ack(students[0].socket, 'teacher:draft-trail-control', { active: true })).ok, false);
  const start = await ack(teacher, 'teacher:draft-trail-control', { active: true });
  assert.equal(start.ok, true);
  for (let n = 1; n <= 10; n++) await Promise.all(students.map(async s => {
    assert.equal((await ack(s.socket, 'student:text', { text: `Draft ${n}: supporting evidence for ${s.id}`, draftTrail: { token: start.status.token, paste: n === 5 } })).ok, true);
  }));
  assert.equal((await ack(teacher, 'teacher:distribute', { items: [{ studentId: students[0].id, text: 'Explain this evidence.' }] })).ok, true);
  const exported = await ack(teacher, 'teacher:session-export');
  assert.equal(exported.ok, true);
  assert.equal(exported.pack.draftTrail.students.length, 30);
  assert.ok(exported.pack.draftTrail.students.some(s => s.events.some(e => e.type === 'feedback')));
  assert.ok(exported.pack.draftTrail.students.every(s => s.events.some(e => e.type === 'paste')));
  const otherTeacher = connect();
  await ack(otherTeacher, 'teacher:join', { code: '9912' });
  assert.equal((await ack(otherTeacher, 'teacher:draft-trail-view', { studentId: students[0].id })).trail, null);
  assert.equal((await ack(teacher, 'teacher:session-import', { pack: exported.pack })).ok, true);
  const view = await ack(teacher, 'teacher:draft-trail-view');
  assert.equal(view.status.active, false);
  assert.equal(view.students.length, 30);
  const restored = await ack(teacher, 'teacher:session-export');
  assert.deepEqual(restored.pack.draftTrail.students.map(s => s.events), exported.pack.draftTrail.students.map(s => s.events));
  const invalid = structuredClone(exported.pack);
  invalid.draftTrail.students[0].events.push({ type: 'change', at: Date.now(), start: 999999, removed: 0, inserted: 'x' });
  assert.equal((await ack(teacher, 'teacher:session-import', { pack: invalid })).ok, false);
  assert.equal((await ack(teacher, 'teacher:draft-trail-view')).students.length, 30);
  await ack(teacher, 'teacher:clear-cards');
  assert.equal((await ack(teacher, 'teacher:draft-trail-view')).students.length, 0);
  console.log('draft-trail-smoke ok: 30 sockets, role/room isolation, paste, feedback, save/reopen, malformed import and reset');
} finally {
  sockets.forEach(s => s.close());
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  await rm(data, { recursive: true, force: true });
}
