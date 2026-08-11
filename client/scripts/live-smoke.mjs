import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const url = process.env.IBOARD_TEST_URL || 'http://127.0.0.1:3211';
const room = '7742';
const teacher = io(url, { transports: ['websocket'] });
const alex = io(url, { transports: ['websocket'] });
const sam = io(url, { transports: ['websocket'] });

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 3000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 3000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

try {
  assert.equal((await emitAck(teacher, 'teacher:join', { code: room })).ok, true);
  const alexJoin = await emitAck(alex, 'student:join', { code: room, name: 'Alex' });
  const samJoin = await emitAck(sam, 'student:join', { code: room, name: 'Sam' });
  assert.equal(alexJoin.ok, true);
  assert.equal(samJoin.ok, true);

  const launch = await emitAck(teacher, 'teacher:live-launch', {
    type: 'choice',
    prompt: 'Which planet is known as the Red Planet?',
    options: ['Earth', 'Mars', 'Venus'],
    correctAnswer: 'Mars',
  });
  assert.equal(launch.ok, true);
  const publicStatePromise = nextEvent(alex, 'live:student');
  await emitAck(alex, 'student:live-sync', {});
  const publicState = await publicStatePromise;
  assert.equal(publicState.activity.correctAnswer, '');

  assert.equal((await emitAck(alex, 'student:live-response', {
    activityId: launch.activity.id,
    value: 'Mars',
  })).ok, true);

  const teacherStatePromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync', {});
  const teacherState = await teacherStatePromise;
  assert.equal(teacherState.responses.length, 1);
  const alexState = teacherState.students.find((student) => student.id === alexJoin.student.id);
  const samState = teacherState.students.find((student) => student.id === samJoin.student.id);
  assert.equal(alexState.engagement.score, 100);
  assert.equal(samState.engagement.score, 0);

  const nudge = nextEvent(sam, 'live:nudge');
  assert.equal((await emitAck(teacher, 'teacher:live-nudge', { studentId: samJoin.student.id })).ok, true);
  assert.equal((await nudge).message, 'Are you still with us?');
  assert.equal((await emitAck(sam, 'student:live-status', { status: 'tech' })).ok, true);

  const reveal = nextEvent(alex, 'live:activity');
  assert.equal((await emitAck(teacher, 'teacher:live-control', { action: 'reveal' })).ok, true);
  assert.equal((await reveal).activity.correctAnswer, 'Mars');

  const shortLaunch = await emitAck(teacher, 'teacher:live-launch', {
    type: 'short',
    prompt: 'Explain your thinking in one sentence.',
    anonymous: true,
    optional: true,
  });
  assert.equal(shortLaunch.ok, true);
  assert.equal((await emitAck(sam, 'student:live-response', {
    activityId: shortLaunch.activity.id,
    value: 'I compared the two examples.',
  })).ok, true);
  const shortTeacherPromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync', {});
  const shortTeacher = await shortTeacherPromise;
  assert.equal(shortTeacher.students.find((student) => student.id === samJoin.student.id).engagement.score, 0);
  const samResponse = shortTeacher.responses.find((response) => response.studentId === samJoin.student.id);
  assert.equal(samResponse.published, false);

  const featuredPromise = nextEvent(alex, 'live:activity');
  assert.equal((await emitAck(teacher, 'teacher:live-publish', {
    activityId: shortLaunch.activity.id,
    studentId: samJoin.student.id,
    published: true,
  })).ok, true);
  const featuredState = await featuredPromise;
  assert.deepEqual(featuredState.featured, [{ value: 'I compared the two examples.', name: 'Anonymous' }]);

  console.log('Live classroom smoke test passed.');
} finally {
  teacher.disconnect();
  alex.disconnect();
  sam.disconnect();
}
