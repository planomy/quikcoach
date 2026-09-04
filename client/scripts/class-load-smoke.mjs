import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const url = process.env.IBOARD_TEST_URL || 'http://127.0.0.1:3211';
const room = process.env.IBOARD_LOAD_TEST_ROOM || '9951';
const socketOptions = process.env.IBOARD_TEST_URL ? {} : { transports: ['websocket'] };
const STUDENT_COUNT = 30;
const TEXT_UPDATES_PER_STUDENT = 8;

const teacher = io(url, socketOptions);
const students = Array.from({ length: STUDENT_COUNT }, (_, index) => ({
  name: `Load Student ${String(index + 1).padStart(2, '0')}`,
  socket: io(url, socketOptions),
  id: 0,
}));

function emitAck(socket, event, payload = {}, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function nextEvent(socket, event, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

try {
  assert.equal((await emitAck(teacher, 'teacher:join', { code: room })).ok, true);

  const joins = await Promise.all(students.map(async (student) => {
    const ack = await emitAck(student.socket, 'student:join', { code: room, name: student.name });
    assert.equal(ack.ok, true);
    student.id = Number(ack.student.id);
    return ack;
  }));
  assert.equal(joins.length, STUDENT_COUNT);
  assert.equal(new Set(students.map((student) => student.id)).size, STUDENT_COUNT);

  // Once the roster is settled, live typing should be lightweight patches only.
  let roomStateCount = 0;
  let studentLiveCount = 0;
  const onRoomState = () => { roomStateCount += 1; };
  const onStudentLive = () => { studentLiveCount += 1; };
  teacher.on('room:state', onRoomState);
  teacher.on('student:live', onStudentLive);

  const startedAt = Date.now();
  for (let round = 0; round < TEXT_UPDATES_PER_STUDENT; round += 1) {
    await Promise.all(students.map((student, index) => emitAck(student.socket, 'student:text', {
      text: `Draft ${round + 1} from ${student.name}. ${'evidence '.repeat((index % 5) + 1)}`,
    })));
  }
  const typingMs = Date.now() - startedAt;

  // Give the teacher socket a moment to drain the final patch events.
  await new Promise((resolve) => setTimeout(resolve, 150));
  teacher.off('room:state', onRoomState);
  teacher.off('student:live', onStudentLive);

  assert.equal(roomStateCount, 0, 'student typing must not rebroadcast full room state');
  assert.equal(studentLiveCount, STUDENT_COUNT * TEXT_UPDATES_PER_STUDENT);
  assert.ok(typingMs < 45_000, `typing burst took too long: ${typingMs}ms`);

  const launch = await emitAck(teacher, 'teacher:live-launch', {
    type: 'choice',
    prompt: 'Choose the strongest evidence.',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'B',
  });
  assert.equal(launch.ok, true);

  await Promise.all(students.map((student, index) => emitAck(student.socket, 'student:live-response', {
    activityId: launch.activity.id,
    value: ['A', 'B', 'C', 'D'][index % 4],
  })));

  const teacherStatePromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync');
  const teacherState = await teacherStatePromise;
  assert.equal(teacherState.students.filter((student) => student.connected).length, STUDENT_COUNT);
  assert.equal(teacherState.responses.length, STUDENT_COUNT);

  console.log(`Class load smoke passed: ${STUDENT_COUNT} students, ${STUDENT_COUNT * TEXT_UPDATES_PER_STUDENT} live text patches in ${typingMs}ms.`);
} finally {
  teacher.disconnect();
  for (const student of students) student.socket.disconnect();
}
