import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const url = process.env.IBOARD_TEST_URL || 'http://127.0.0.1:3211';
const room = process.env.IBOARD_SESSION_TEST_ROOM || '8844';
const socketOptions = process.env.IBOARD_TEST_URL
  ? { maxHttpBufferSize: 48e6 }
  : { transports: ['websocket'], maxHttpBufferSize: 48e6 };

const teacher = io(url, socketOptions);
const student = io(url, socketOptions);

function emitAck(socket, event, payload = {}, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

try {
  assert.equal((await emitAck(teacher, 'teacher:join', { code: room })).ok, true);
  await emitAck(teacher, 'teacher:clear-cards', {});

  const join = await emitAck(student, 'student:join', { code: room, name: 'Session Smoke' });
  assert.equal(join.ok, true);
  const studentId = Number(join.student.id);

  await emitAck(student, 'student:text', {
    text: 'Session pack round-trip draft with enough words for evidence.',
    richTextHtml: '<p>Session pack round-trip draft with enough words for evidence.</p>',
  });

  await emitAck(teacher, 'teacher:board-post', {
    kind: 'text',
    title: 'Teacher',
    text: 'Session teacher card',
  });

  await emitAck(teacher, 'teacher:distribute', {
    items: [{ studentId, text: 'Keep going — strong opening.' }],
  });

  const exported = await emitAck(teacher, 'teacher:session-export', {}, 60_000);
  assert.equal(exported.ok, true, exported.error || 'export failed');
  assert.equal(exported.pack?.format, 'iboard');
  assert.equal(exported.pack?.version, 1);
  assert.equal(exported.pack.students.length, 1);
  assert.match(exported.pack.students[0].text, /round-trip draft/);
  assert.equal(exported.pack.posts.length, 1);
  assert.ok(
    Object.values(exported.pack.teacherNotesByExportId || {}).some((notes) => notes?.length),
    'expected teacher notes in pack'
  );

  await emitAck(teacher, 'teacher:clear-cards', {});
  const emptyState = await emitAck(teacher, 'teacher:session-export');
  assert.equal(emptyState.pack.students.length, 0);

  const imported = await emitAck(teacher, 'teacher:session-import', { pack: exported.pack }, 60_000);
  assert.equal(imported.ok, true, imported.error || 'import failed');
  assert.equal(imported.studentCount, 1);
  assert.equal(imported.postCount, 1);

  const restored = await emitAck(teacher, 'teacher:session-export');
  assert.equal(restored.pack.students.length, 1);
  assert.equal(restored.pack.students[0].text, exported.pack.students[0].text);
  assert.equal(restored.pack.posts[0].text, 'Session teacher card');
  assert.ok(
    Object.values(restored.pack.teacherNotesByExportId || {}).some((notes) =>
      notes?.some((n) => /Keep going/.test(n.text))
    ),
    'teacher notes should survive restore'
  );

  console.log('session-smoke ok');
  process.exit(0);
} catch (error) {
  console.error('session-smoke failed:', error);
  process.exit(1);
} finally {
  teacher.close();
  student.close();
}
