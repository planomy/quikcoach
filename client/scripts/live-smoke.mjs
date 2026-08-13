import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const url = process.env.IBOARD_TEST_URL || 'http://127.0.0.1:3211';
const room = '7742';
const teacher = io(url, { transports: ['websocket'] });
const alex = io(url, { transports: ['websocket'] });
const sam = io(url, { transports: ['websocket'] });
let returningStudent = null;
let duplicateStudent = null;

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

  assert.equal((await emitAck(alex, 'student:text', { text: 'My first saved classroom response.' })).ok, true);
  assert.equal((await emitAck(teacher, 'teacher:snapshot-save', { label: 'Evidence lesson one' })).ok, true);
  assert.equal((await emitAck(alex, 'student:text', { text: 'My improved classroom response with evidence.' })).ok, true);
  assert.equal((await emitAck(teacher, 'teacher:snapshot-save', { label: 'Evidence lesson two' })).ok, true);
  // Saving again without a student edit should not inflate their portfolio.
  assert.equal((await emitAck(teacher, 'teacher:snapshot-save', { label: 'Repeated room save' })).ok, true);
  const evidenceRes = await fetch(`${url}/api/rooms/${room}/evidence-students`);
  assert.equal(evidenceRes.status, 200);
  const evidence = await evidenceRes.json();
  const alexEvidence = evidence.students.find((student) => student.name === 'Alex');
  assert.equal(alexEvidence.entries.length, 2);
  assert.equal(alexEvidence.entries[0].label, 'Repeated room save');
  assert.equal(alexEvidence.entries[0].text, 'My improved classroom response with evidence.');
  assert.equal(alexEvidence.entries[1].label, 'Evidence lesson one');
  assert.equal(evidence.students.some((student) => student.name === 'Sam'), false);

  const launch = await emitAck(teacher, 'teacher:live-launch', {
    type: 'choice',
    prompt: 'Which planet is known as the Red Planet?',
    options: ['Earth', 'Mars', 'Venus'],
    correctAnswer: 'Mars',
    imageUrl: 'data:image/jpeg;base64,ZmFrZQ==',
    timerSeconds: 15,
  });
  assert.equal(launch.ok, true);
  assert.equal(launch.activity.questionNumber, 1);
  assert.equal(launch.activity.timerSeconds, 15);
  assert.match(launch.activity.imageUrl, /^\/api\/live-activities\/.+\/image$/);
  const publicStatePromise = nextEvent(alex, 'live:student');
  await emitAck(alex, 'student:live-sync', {});
  const publicState = await publicStatePromise;
  assert.equal(publicState.activity.correctAnswer, '');
  assert.equal(publicState.activity.timerSeconds, 15);
  assert.equal(publicState.activity.imageUrl, launch.activity.imageUrl);
  const imageRes = await fetch(`${url}${launch.activity.imageUrl}`);
  assert.equal(imageRes.status, 200);
  assert.match(imageRes.headers.get('content-type') || '', /^image\//);

  assert.equal((await emitAck(alex, 'student:live-response', {
    activityId: launch.activity.id,
    value: 'Mars',
  })).ok, true);
  assert.equal((await emitAck(alex, 'student:live-confidence', { activityId: launch.activity.id, confidence: 'confident' })).ok, true);

  const teacherStatePromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync', {});
  const teacherState = await teacherStatePromise;
  assert.equal(teacherState.responses.length, 1);
  assert.equal(teacherState.responses[0].confidence, 'confident');
  const alexState = teacherState.students.find((student) => student.id === alexJoin.student.id);
  const samState = teacherState.students.find((student) => student.id === samJoin.student.id);
  assert.equal(alexState.engagement.score, 100);
  assert.equal(samState.engagement.score, 0);

  assert.equal((await emitAck(sam, 'student:live-status', { status: 'stuck' })).ok, true);
  const helpSeen = nextEvent(sam, 'live:help-seen');
  assert.equal((await emitAck(teacher, 'teacher:live-acknowledge', { studentId: samJoin.student.id })).ok, true);
  await helpSeen;

  const realert = nextEvent(sam, 'live:realert');
  const realertAck = await emitAck(teacher, 'teacher:live-realert', {});
  assert.equal(realertAck.ok, true);
  assert.equal(realertAck.count, 1);
  assert.equal((await realert).activity.id, launch.activity.id);

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
  assert.equal(shortLaunch.activity.questionNumber, 2);
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
  const featuredNotice = nextEvent(sam, 'live:featured');
  assert.equal((await emitAck(teacher, 'teacher:live-publish', {
    activityId: shortLaunch.activity.id,
    studentId: samJoin.student.id,
    published: true,
  })).ok, true);
  const featuredState = await featuredPromise;
  await featuredNotice;
  assert.deepEqual(featuredState.featured, [{ value: 'I compared the two examples.', name: 'Anonymous' }]);

  const wallStatePromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync', {});
  const wallState = await wallStatePromise;
  assert.equal(wallState.featuredWall.length, 1);
  assert.equal(wallState.featuredWall[0].value, 'I compared the two examples.');
  assert.equal((await emitAck(teacher, 'teacher:featured-label', { id: wallState.featuredWall[0].id, label: 'Clear explanation' })).ok, true);

  const laterLaunch = await emitAck(teacher, 'teacher:live-launch', {
    type: 'truefalse', prompt: 'A featured answer should persist.', options: [],
  });
  assert.equal(laterLaunch.ok, true);
  const persistedPromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync', {});
  const persisted = await persistedPromise;
  assert.equal(persisted.featuredWall[0].label, 'Clear explanation');

  const originalStudent = io(url, { transports: ['websocket'] });
  const originalJoin = await emitAck(originalStudent, 'student:join', { code: room, name: 'Taylor Smith' });
  assert.equal(originalJoin.ok, true);
  const identityLaunch = await emitAck(teacher, 'teacher:live-launch', {
    type: 'truefalse', prompt: 'Identity should survive a fresh login.', options: [],
  });
  assert.equal(identityLaunch.ok, true);
  assert.equal((await emitAck(originalStudent, 'student:live-response', {
    activityId: identityLaunch.activity.id,
    value: 'True',
  })).ok, true);
  const identityStatePromise = nextEvent(teacher, 'live:teacher');
  await emitAck(teacher, 'teacher:live-sync', {});
  const identityState = await identityStatePromise;
  const beforeLogout = identityState.students.find((student) => student.id === originalJoin.student.id);
  assert.equal(beforeLogout.engagement.responded, 1);
  originalStudent.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));

  returningStudent = io(url, { transports: ['websocket'] });
  const returnJoin = await emitAck(returningStudent, 'student:join', { code: room, name: '  taylor   smith ' });
  assert.equal(returnJoin.ok, true);
  assert.equal(returnJoin.resumed, true);
  assert.equal(returnJoin.student.id, originalJoin.student.id);
  assert.equal(returnJoin.student.engagement.responded, 1);
  assert.equal(returnJoin.student.engagement.opportunities, beforeLogout.engagement.opportunities);

  duplicateStudent = io(url, { transports: ['websocket'] });
  const duplicateJoin = await emitAck(duplicateStudent, 'student:join', { code: room, name: 'Taylor Smith' });
  assert.equal(duplicateJoin.ok, false);
  assert.match(duplicateJoin.error, /already connected/i);

  console.log('Live classroom smoke test passed.');
} finally {
  teacher.disconnect();
  alex.disconnect();
  sam.disconnect();
  returningStudent?.disconnect();
  duplicateStudent?.disconnect();
}
