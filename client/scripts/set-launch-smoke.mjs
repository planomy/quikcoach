import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import {
  formatSetAnswerPreview,
  getSetAnswerPairs,
  parseSetAnswers,
} from '../src/lib/liveResponseSets.js';
import { formatLiveAnswer } from '../src/lib/liveResponseUnknown.js';

const url = process.env.IBOARD_TEST_URL || 'http://127.0.0.1:3211';
const room = process.env.IBOARD_SET_TEST_ROOM || '6631';
const socketOptions = process.env.IBOARD_TEST_URL ? {} : { transports: ['websocket'] };

const teacher = io(url, socketOptions);
const student = io(url, socketOptions);

function emitAck(socket, event, payload = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function nextEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const setQuestions = [
  { id: 'p1', type: 'short', prompt: 'What tension should this scene develop?', options: [] },
  { id: 'p2', type: 'short', prompt: 'What should the reader notice first?', options: [] },
  { id: 'p3', type: 'choice', prompt: 'Which craft move fits best?', options: ['Action', 'Dialogue', 'Symbol'], correctAnswer: 'Symbol' },
];

try {
  // Display helpers must never leak JSON braces into chips/tooltips.
  const samplePayload = JSON.stringify({
    p1: 'spooky atmosphere in the forest',
    p2: 'the frightened face',
    p3: 'Symbol',
  });
  const preview = formatSetAnswerPreview(samplePayload, setQuestions);
  assert.equal(preview.includes('{'), false);
  assert.equal(preview.includes('"p1"'), false);
  assert.match(preview, /spooky atmosphere/);
  assert.equal(formatLiveAnswer(samplePayload).includes('{'), false);
  const pairs = getSetAnswerPairs(samplePayload, setQuestions);
  assert.equal(pairs.length, 3);
  assert.equal(pairs[0].prompt, 'What tension should this scene develop?');
  assert.equal(pairs[0].answer, 'spooky atmosphere in the forest');
  assert.equal(pairs[2].answer, 'Symbol');

  assert.equal((await emitAck(teacher, 'teacher:join', { code: room })).ok, true);
  const join = await emitAck(student, 'student:join', { code: room, name: 'Set Student' });
  assert.equal(join.ok, true);

  // Incomplete sets must be rejected.
  const tooShort = await emitAck(teacher, 'teacher:live-launch', {
    type: 'set',
    prompt: 'Mini set',
    questions: [setQuestions[0]],
  });
  assert.equal(tooShort.ok, false);

  const launch = await emitAck(teacher, 'teacher:live-launch', {
    type: 'set',
    prompt: 'Opening scene craft check',
    questions: setQuestions,
    anonymous: false,
    optional: false,
  });
  assert.equal(launch.ok, true);
  assert.equal(launch.activity.type, 'set');
  assert.equal(launch.activity.prompt, 'Opening scene craft check');
  assert.ok(Array.isArray(launch.activity.questions));
  assert.equal(launch.activity.questions.length, 3);
  assert.equal(launch.activity.questions[0].id, 'p1');
  assert.equal(launch.activity.questions[2].options.length, 3);

  // Students must receive the full question list (not just the set title).
  const studentStatePromise = nextEvent(student, 'live:student');
  await emitAck(student, 'student:live-sync', {});
  const studentState = await studentStatePromise;
  assert.equal(studentState.activity?.type, 'set');
  assert.equal(studentState.activity.questions.length, 3);
  assert.equal(studentState.activity.questions[1].prompt, 'What should the reader notice first?');

  // Partial answers rejected.
  const partial = await emitAck(student, 'student:live-response', {
    activityId: launch.activity.id,
    value: JSON.stringify({ p1: 'only one answered' }),
  });
  assert.equal(partial.ok, false);

  const answers = {
    p1: 'It should develop a spooky atmosphere because it is in the forest',
    p2: 'the dark and the frightened face of the character',
    p3: 'Symbol',
  };
  assert.equal((await emitAck(student, 'student:live-response', {
    activityId: launch.activity.id,
    value: JSON.stringify(answers),
  })).ok, true);

  const teacherStatePromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync', {});
  const teacherState = await teacherStatePromise;
  assert.equal(teacherState.activity?.type, 'set');
  assert.equal(teacherState.activity.questions.length, 3);
  const response = teacherState.responses.find((item) => Number(item.studentId) === Number(join.student.id));
  assert.ok(response, 'teacher should see the set response');
  assert.equal(response.name, 'Set Student');

  const stored = parseSetAnswers(response.value);
  assert.equal(stored.p1, answers.p1);
  assert.equal(stored.p2, answers.p2);
  assert.equal(stored.p3, answers.p3);

  const teacherPairs = getSetAnswerPairs(response.value, teacherState.activity.questions);
  assert.equal(teacherPairs.length, 3);
  assert.equal(teacherPairs[0].answer, answers.p1);
  assert.equal(formatLiveAnswer(response.value).includes('{'), false);
  assert.equal(formatSetAnswerPreview(response.value, teacherState.activity.questions).includes('{'), false);

  // Clearing leaves the room ready for the next launch.
  assert.equal((await emitAck(teacher, 'teacher:live-control', { action: 'clear' })).ok, true);

  console.log('Set launch smoke test passed.');
} finally {
  teacher.disconnect();
  student.disconnect();
}
