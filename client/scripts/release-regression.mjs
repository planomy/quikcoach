import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const url = process.env.IBOARD_TEST_URL || 'http://127.0.0.1:3211';
const room = process.env.IBOARD_RELEASE_TEST_ROOM || '8841';
const socketOptions = process.env.IBOARD_TEST_URL ? {} : { transports: ['websocket'] };

const teacher = io(url, socketOptions);
const asker = io(url, socketOptions);
const responder = io(url, socketOptions);
let restored = null;

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 4000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 4000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  // Core room join.
  assert.equal((await emitAck(teacher, 'teacher:join', { code: room })).ok, true);
  const askerJoin = await emitAck(asker, 'student:join', { code: room, name: 'Avery' });
  const responderJoin = await emitAck(responder, 'student:join', { code: room, name: 'Jordan' });
  assert.equal(askerJoin.ok, true);
  assert.equal(responderJoin.ok, true);
  assert.equal((await emitAck(responder, 'student:year', { year_level: 'yr9' })).ok, true);

  // Privacy contract: a student's anonymous-if-shared request cannot be overridden
  // by the teacher, but classmates' responses remain named to the teacher.
  assert.equal((await emitAck(asker, 'student:qna-submit', {
    text: 'Can someone explain the second method?',
    anonymous: true,
  })).ok, true);

  const qnaBeforePromise = nextEvent(teacher, 'qna:teacher');
  await emitAck(teacher, 'teacher:qna-sync');
  const qnaBefore = await qnaBeforePromise;
  const question = qnaBefore.questions.find((item) => item.text === 'Can someone explain the second method?');
  assert.ok(question);
  assert.equal(question.anonymousRequested, true);

  // Deliberately request named sharing here. The server must refuse the override.
  const shared = await emitAck(teacher, 'teacher:qna-ask-room', {
    questionId: question.id,
    anonymous: false,
  });
  assert.equal(shared.ok, true);
  assert.equal(Number(shared.activity.sourceQuestionId), Number(question.id));
  assert.equal(shared.activity.anonymous, false, 'shared student question must keep response identities visible');

  const qnaAfterPromise = nextEvent(teacher, 'qna:teacher');
  await emitAck(teacher, 'teacher:qna-sync');
  const qnaAfter = await qnaAfterPromise;
  const published = qnaAfter.questions.find((item) => Number(item.id) === Number(question.id));
  assert.equal(published.publishedAnonymous, true, 'anonymous asker must stay anonymous');

  const askerBlocked = await emitAck(asker, 'student:live-response', {
    activityId: shared.activity.id,
    value: 'My own question',
  });
  assert.equal(askerBlocked.ok, false, 'original asker should not be asked to answer their own question');

  assert.equal((await emitAck(responder, 'student:live-response', {
    activityId: shared.activity.id,
    value: 'I would compare the two steps first.',
  })).ok, true);

  const livePromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync');
  const live = await livePromise;
  const response = live.responses.find((item) => Number(item.studentId) === Number(responderJoin.student.id));
  assert.ok(response);
  assert.equal(response.name, 'Jordan');
  assert.equal(live.activity.anonymous, false);

  // Teacher-created anonymous questions still anonymise class responses as designed.
  const teacherAnonymous = await emitAck(teacher, 'teacher:live-launch', {
    type: 'short',
    prompt: 'Share one thought anonymously.',
    anonymous: true,
    optional: true,
  });
  assert.equal(teacherAnonymous.ok, true);
  assert.equal(teacherAnonymous.activity.anonymous, true);
  await emitAck(teacher, 'teacher:live-control', { action: 'clear' });

  // Start New Class handoff: preserve identity/year, issue a fresh student id, and
  // do not let cleanup of the old socket kick the freshly restored connection.
  const resetPromise = nextEvent(responder, 'class:reset');
  const resetAck = await emitAck(teacher, 'teacher:start-new-class');
  assert.equal(resetAck.ok, true);
  const reset = await resetPromise;
  assert.equal(reset.code, room);
  assert.equal(reset.name, 'Jordan');
  assert.equal(reset.yearLevel, 'yr9');

  const freshJoin = await emitAck(responder, 'student:join', {
    code: reset.code,
    name: reset.name,
  });
  assert.equal(freshJoin.ok, true);
  assert.notEqual(Number(freshJoin.student.id), Number(responderJoin.student.id));
  assert.equal((await emitAck(responder, 'student:year', { year_level: reset.yearLevel })).ok, true);

  restored = io(url, socketOptions);
  const restoredJoin = await emitAck(restored, 'student:rejoin', {
    code: room,
    studentId: freshJoin.student.id,
  });
  assert.equal(restoredJoin.ok, true);
  assert.equal(restoredJoin.student.name, 'Jordan');
  assert.equal(restoredJoin.student.year_level, 'yr9');

  await sleep(1500);
  assert.equal(restored.connected, true, 'freshly restored socket must survive old-class cleanup');

  const finalLivePromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync');
  const finalLive = await finalLivePromise;
  const jordan = finalLive.students.find((item) => Number(item.id) === Number(freshJoin.student.id));
  assert.ok(jordan);
  assert.equal(jordan.connected, true);
  assert.equal(jordan.year_level, 'yr9');

  const finalQnaPromise = nextEvent(teacher, 'qna:teacher');
  await emitAck(teacher, 'teacher:qna-sync');
  assert.deepEqual((await finalQnaPromise).questions, []);

  console.log('Release regression smoke test passed.');
} finally {
  teacher.disconnect();
  asker.disconnect();
  responder.disconnect();
  restored?.disconnect();
}
