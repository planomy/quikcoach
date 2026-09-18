import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const url = process.env.IBOARD_TEST_URL || 'http://127.0.0.1:3211';
const room = process.env.IBOARD_TIMER_TEST_ROOM || '7739';
const socketOptions = process.env.IBOARD_TEST_URL ? {} : { transports: ['websocket'] };
const teacher = io(url, socketOptions);
const student = io(url, socketOptions);

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), 5000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timeout);
      resolve(ack);
    });
  });
}

function nextEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

try {
  assert.equal((await emitAck(teacher, 'teacher:join', { code: room })).ok, true);
  assert.equal((await emitAck(student, 'student:join', { code: room, name: 'Timer Student' })).ok, true);

  const studentStart = nextEvent(student, 'timer:state');
  const started = await emitAck(teacher, 'teacher:timer-control', { action: 'start', seconds: 10 });
  assert.equal(started.ok, true);
  assert.equal(started.timer.active, true);
  assert.equal(started.timer.running, true);
  assert.ok(started.timer.remainingSeconds >= 9 && started.timer.remainingSeconds <= 10);
  assert.equal((await studentStart).timer.running, true);

  const roomResponse = await fetch(`${url}/api/rooms/${room}`);
  assert.equal(roomResponse.status, 200);
  const roomState = await roomResponse.json();
  assert.equal(roomState.room.timer.active, true);

  const studentPause = nextEvent(student, 'timer:state');
  const paused = await emitAck(teacher, 'teacher:timer-control', { action: 'pause' });
  assert.equal(paused.ok, true);
  assert.equal(paused.timer.running, false);
  assert.equal((await studentPause).timer.running, false);
  const beforeAdd = paused.timer.remainingSeconds;

  const studentAdd = nextEvent(student, 'timer:state');
  const added = await emitAck(teacher, 'teacher:timer-control', { action: 'add', seconds: 60 });
  assert.equal(added.ok, true);
  assert.equal(added.timer.remainingSeconds, beforeAdd + 60);
  assert.equal((await studentAdd).timer.remainingSeconds, beforeAdd + 60);

  const studentResume = nextEvent(student, 'timer:state');
  const resumed = await emitAck(teacher, 'teacher:timer-control', { action: 'resume' });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.timer.running, true);
  assert.equal((await studentResume).timer.running, true);

  const studentEnd = nextEvent(student, 'timer:state');
  const ended = await emitAck(teacher, 'teacher:timer-control', { action: 'end' });
  assert.equal(ended.ok, true);
  assert.equal(ended.timer.active, false);
  assert.equal((await studentEnd).timer.active, false);

  const timesUp = nextEvent(student, 'timer:times-up', 12000);
  const finalStart = await emitAck(teacher, 'teacher:timer-control', { action: 'start', seconds: 10 });
  assert.equal(finalStart.ok, true);
  await timesUp;
  const finishedRoomResponse = await fetch(`${url}/api/rooms/${room}`);
  const finishedRoom = await finishedRoomResponse.json();
  assert.equal(finishedRoom.room.timer.running, false);
  assert.equal(finishedRoom.room.timer.remainingSeconds, 0);
  assert.equal((await emitAck(teacher, 'teacher:timer-control', { action: 'end' })).ok, true);

  console.log('Room timer smoke test passed.');
} finally {
  teacher.disconnect();
  student.disconnect();
}
