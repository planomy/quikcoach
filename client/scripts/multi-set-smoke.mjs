import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { normalizeSetQuestions, buildSetInboxDistributeItems, parseSetAnswers } from '../src/lib/liveResponseSets.js';

const url = process.env.IBOARD_TEST_URL || 'http://127.0.0.1:3338';
let server;
if (!process.env.IBOARD_TEST_URL) {
  server = spawn(process.execPath, ['--import', './server/richTextPatch.js', '--import', './server/feedbackPatch.js', '--import', './server/ownershipPatch.js', 'server/index.js'], { env: { ...process.env, PORT: '3338', DATA_DIR: await mkdtemp(`${tmpdir()}/iboard-multiset-`) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Test server exited'); })]);
}
const teacher = io(url, { transports: ['websocket'] });
const student = io(url, { transports: ['websocket'] });
const ack = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(5000).emit(event, payload, (err, result) => err ? reject(err) : resolve(result)));
try {
  assert.equal((await ack(teacher, 'teacher:join', {code:'8632'})).ok, true);
  const joined = await ack(student, 'student:join', {code:'8632',name:'Multi-set student'});
  assert.equal(joined.ok,true);
  const questions = Array.from({length:60},(_,i)=>({id:`q-${i}`,type:'short',prompt:`Question ${i}`,helper:`Set ${Math.floor(i/6)+1}`}));
  assert.equal(normalizeSetQuestions(questions).length,60);
  const launched=await ack(teacher,'teacher:live-launch',{type:'set',prompt:'Combined sets',questions});
  assert.equal(launched.ok,true);
  assert.equal(launched.activity.questions.length,60);
  assert.equal(launched.activity.questions[59].helper,'Set 10');
  const answers=Object.fromEntries(questions.map(q=>[q.id,'A'.repeat(500)]));
  assert.equal((await ack(student,'student:live-response',{activityId:launched.activity.id,value:JSON.stringify(answers)})).ok,true);
  const statePromise=new Promise(resolve=>student.once('live:student',resolve));
  await ack(student,'student:live-sync',{});
  const state=await statePromise;
  assert.equal(state.activity.questions.length,60);
  // Server accepted the full >8KB answer object without truncating its JSON.
  assert.equal(Object.keys(parseSetAnswers(state.response.value)).length,60);
  assert.equal(parseSetAnswers(state.response.value)['q-59'].length,500);
  const items=['First set','Second set'].flatMap(setName=>buildSetInboxDistributeItems({setName,questions:questions.slice(0,6),studentIds:[joined.student.id]}).items);
  const received=[];
  const bothReceived=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Inbox delivery timed out')),5000);
    student.on('feedback:batch',payload=>{
      received.push(...payload.items);
      if(received.length===2){clearTimeout(timer);resolve();}
    });
  });
  const inbox=await ack(teacher,'teacher:distribute',{items});
  assert.equal(inbox.ok,true);
  assert.equal(inbox.count,2);
  await bothReceived;
  assert.deepEqual(received.map(item=>item.title),['First set','Second set']);
  assert.equal(received[1].questions.length,6);
  console.log('multi-set-smoke ok: 60 questions, long answers, distinct Inbox sets');
} finally {teacher.disconnect();student.disconnect();server?.kill();}
