import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { openDatabase, queries } from './db.js';
import { truncateToWordLimit } from './text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const clientDist = path.join(__dirname, '..', 'client', 'dist');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '3mb' }));

const db = openDatabase();
const boardMediaRoot = path.join(dataDir, 'board-media');
if (!fs.existsSync(boardMediaRoot)) {
  fs.mkdirSync(boardMediaRoot, { recursive: true });
}

/** Same 4-digit normalisation as join handlers — avoids room:123 vs room:0123 split. */
function normalizeRoomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

function roomSocketName(code) {
  return `room:${normalizeRoomCode(code)}`;
}

function boardMediaDir(code) {
  const c = normalizeRoomCode(code);
  const dir = path.join(boardMediaRoot, c);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeMediaFilename(name) {
  const base = path.basename(String(name || ''));
  return /^[a-zA-Z0-9._-]+$/.test(base) ? base : '';
}

function unlinkRoomMedia(code, filename) {
  const fn = safeMediaFilename(filename);
  if (!fn) return;
  const fp = path.join(boardMediaDir(code), fn);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {
    /* ignore */
  }
}

function decodeImageBase64(imageBase64, mimeType) {
  const raw = String(imageBase64 || '');
  const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
  if (!b64 || b64.length < 32) return { error: 'No image data' };
  if (b64.length > 2.8e6) return { error: 'Image too large — try a smaller screenshot' };
  const mime = String(mimeType || 'image/jpeg').toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return { error: 'Could not read image' };
  }
  if (!buf.length) return { error: 'Could not read image' };
  return { buf, ext };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/rooms', (req, res) => {
  try {
    const code = String(req.body.code || '')
      .replace(/\D/g, '')
      .slice(0, 4)
      .padStart(4, '0');
    if (code.length !== 4) {
      return res.status(400).json({ error: 'Room code must be 4 digits' });
    }
    const row = queries.ensureRoom(db, code);
    res.json({ room: queries.rowToRoom(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/rooms/:code', (req, res) => {
  try {
    const code = req.params.code;
    const row = queries.ensureRoom(db, code);
    const students = queries.listStudents(db, code);
    res.json({
      room: queries.rowToRoom(row),
      students: students.map(queries.rowToStudent),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/rooms/:code/snapshots', (req, res) => {
  try {
    const code = String(req.params.code || '')
      .replace(/\D/g, '')
      .slice(0, 4)
      .padStart(4, '0');
    if (code.length !== 4) return res.status(400).json({ error: 'Invalid room' });
    queries.ensureRoom(db, code);
    const snapshots = queries.listSnapshotMeta(db, code);
    res.json({ snapshots });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/rooms/:code/snapshots/:id', (req, res) => {
  try {
    const code = String(req.params.code || '')
      .replace(/\D/g, '')
      .slice(0, 4)
      .padStart(4, '0');
    const id = Number(req.params.id);
    if (code.length !== 4 || !id) return res.status(400).json({ error: 'Invalid request' });
    const snap = queries.getSnapshot(db, id);
    if (!snap || snap.room_code !== code) return res.status(404).json({ error: 'Not found' });
    res.json(snap);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/board-media/:code/:filename', (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    const filename = safeMediaFilename(req.params.filename);
    if (code.length !== 4 || !filename) return res.status(400).end();
    const dir = boardMediaDir(code);
    const filePath = path.join(dir, filename);
    if (!filePath.startsWith(dir + path.sep) && filePath !== dir) {
      return res.status(400).end();
    }
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 3e6,
});

function buildRoomPayload(code) {
  const c = normalizeRoomCode(code);
  const row = queries.ensureRoom(db, c);
  const students = queries.listStudents(db, c);
  const posts = queries.listBoardPosts(db, c);
  return {
    room: queries.rowToRoom(row),
    students: students.map(queries.rowToStudent),
    posts: posts.map(queries.rowToBoardPost),
  };
}

function emitRoomState(code, payload) {
  io.to(roomSocketName(code)).emit('room:state', payload);
}

function broadcastRoom(code) {
  const payload = buildRoomPayload(code);
  emitRoomState(code, payload);
  return payload;
}

/** Last broadcast per room — resent when a student joins/rejoins so late/reconnect tabs still see it. */
const lastBroadcastByRoom = new Map();

/** Active student sockets are kept in memory; learning history stays in SQLite. */
const connectedStudentSockets = new Map();

function studentSocketName(studentId) {
  return `student:${Number(studentId)}`;
}

function teacherSocketName(code) {
  return `teacher:${normalizeRoomCode(code)}`;
}

function addStudentPresence(studentId, socketId) {
  const sid = Number(studentId);
  const ids = connectedStudentSockets.get(sid) || new Set();
  ids.add(socketId);
  connectedStudentSockets.set(sid, ids);
}

function removeStudentPresence(studentId, socketId) {
  const sid = Number(studentId);
  const ids = connectedStudentSockets.get(sid);
  if (!ids) return;
  ids.delete(socketId);
  if (!ids.size) connectedStudentSockets.delete(sid);
}

function isStudentConnected(studentId) {
  return (connectedStudentSockets.get(Number(studentId))?.size || 0) > 0;
}

function publicLiveActivity(activity) {
  if (!activity) return null;
  const { correctAnswer, ...safe } = activity;
  return {
    ...safe,
    correctAnswer: activity.revealed ? correctAnswer : '',
  };
}

function buildTeacherLivePayload(code) {
  const c = normalizeRoomCode(code);
  const activity = queries.getLiveActivity(db, c);
  const responses = activity ? queries.listLiveResponses(db, c) : [];
  const responseByStudent = new Map(responses.map((response) => [response.studentId, response]));
  const students = queries.listStudents(db, c).map((row) => {
    const student = queries.rowToStudent(row);
    return {
      id: student.id,
      name: student.name,
      year_level: student.year_level,
      connected: isStudentConnected(student.id),
      engagement_status: student.engagement_status,
      engagement: student.engagement,
      hasResponded: responseByStudent.has(student.id),
    };
  });
  return { activity, responses, students };
}

function emitStudentLiveState(code, studentId) {
  const c = normalizeRoomCode(code);
  const activity = queries.getLiveActivity(db, c);
  const responses = activity ? queries.listLiveResponses(db, c) : [];
  const own = responses.find((response) => response.studentId === Number(studentId)) || null;
  io.to(studentSocketName(studentId)).emit('live:student', {
    activity: publicLiveActivity(activity),
    response: own ? { value: own.value, submittedAt: own.submittedAt } : null,
  });
}

function emitLiveState(code) {
  const c = normalizeRoomCode(code);
  const teacherPayload = buildTeacherLivePayload(c);
  io.to(teacherSocketName(c)).emit('live:teacher', teacherPayload);
  const activity = teacherPayload.activity;
  const responses = teacherPayload.responses || [];
  const featured = activity?.type === 'short'
    ? responses.filter((response) => response.published).map((response) => ({
        value: response.value,
        name: activity.anonymous ? 'Anonymous' : response.name,
      }))
    : [];
  io.to(roomSocketName(c)).emit('live:activity', {
    activity: publicLiveActivity(activity),
    responseCount: responses.length,
    featured,
  });
  for (const student of teacherPayload.students) emitStudentLiveState(c, student.id);
}

function connectedStudentsInRoom(code) {
  const c = normalizeRoomCode(code);
  return queries
    .listStudents(db, c)
    .map((row) => Number(row.id))
    .filter(isStudentConnected);
}

function emitBroadcastToRoom(code, payload) {
  const c = normalizeRoomCode(code);
  const room = roomSocketName(c);
  lastBroadcastByRoom.set(c, payload);
  io.to(room).emit('broadcast:exemplars', payload);
}

io.on('connection', (socket) => {
  socket.on('teacher:join', ({ code }, cb) => {
    try {
      const c = String(code || '').replace(/\D/g, '').slice(0, 4).padStart(4, '0');
      if (c.length !== 4) {
        cb?.({ ok: false, error: 'Invalid room' });
        return;
      }
      queries.ensureRoom(db, c);
      socket.join(roomSocketName(c));
      socket.join(teacherSocketName(c));
      socket.data.role = 'teacher';
      socket.data.roomCode = c;
      broadcastRoom(c);
      socket.emit('live:teacher', buildTeacherLivePayload(c));
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Server error' });
    }
  });

  socket.on('student:join', ({ code, name }, cb) => {
    try {
      const c = String(code || '').replace(/\D/g, '').slice(0, 4).padStart(4, '0');
      const n = String(name || '').trim();
      if (c.length !== 4 || !n) {
        cb?.({ ok: false, error: 'Enter room code and name' });
        return;
      }
      queries.ensureRoom(db, c);
      const studentRow = queries.addStudent(db, c, n);
      const student = queries.rowToStudent(studentRow);
      socket.join(roomSocketName(c));
      socket.join(studentSocketName(student.id));
      socket.data.role = 'student';
      socket.data.roomCode = c;
      socket.data.studentId = student.id;
      addStudentPresence(student.id, socket.id);
      const payload = buildRoomPayload(c);
      cb?.({ ok: true, student, room: payload.room, students: payload.students });
      emitRoomState(c, payload);
      const last = lastBroadcastByRoom.get(c);
      if (last) socket.emit('broadcast:exemplars', last);
      emitLiveState(c);
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Server error' });
    }
  });

  socket.on('student:rejoin', ({ code, studentId }, cb) => {
    try {
      const c = String(code || '').replace(/\D/g, '').slice(0, 4).padStart(4, '0');
      const sid = Number(studentId);
      if (c.length !== 4 || !sid) {
        cb?.({ ok: false, error: 'Invalid rejoin' });
        return;
      }
      const row = queries.getStudent(db, sid);
      if (!row || normalizeRoomCode(row.room_code) !== c) {
        cb?.({ ok: false, error: 'Session expired — join again' });
        return;
      }
      const student = queries.rowToStudent(row);
      socket.join(roomSocketName(c));
      socket.join(studentSocketName(student.id));
      socket.data.role = 'student';
      socket.data.roomCode = c;
      socket.data.studentId = student.id;
      addStudentPresence(student.id, socket.id);
      const payload = buildRoomPayload(c);
      cb?.({ ok: true, student, room: payload.room, students: payload.students });
      emitRoomState(c, payload);
      const last = lastBroadcastByRoom.get(c);
      if (last) socket.emit('broadcast:exemplars', last);
      emitLiveState(c);
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Server error' });
    }
  });

  socket.on('teacher:live-sync', (_payload, cb) => {
    const code = socket.data.roomCode;
    if (socket.data.role !== 'teacher' || !code) {
      cb?.({ ok: false });
      return;
    }
    const payload = buildTeacherLivePayload(code);
    socket.emit('live:teacher', payload);
    cb?.({ ok: true });
  });

  socket.on('student:live-sync', (_payload, cb) => {
    const code = socket.data.roomCode;
    const sid = socket.data.studentId;
    if (socket.data.role !== 'student' || !code || !sid) {
      cb?.({ ok: false });
      return;
    }
    emitStudentLiveState(code, sid);
    cb?.({ ok: true });
  });

  socket.on('teacher:live-launch', (raw, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const allowedTypes = new Set(['choice', 'truefalse', 'rating', 'short']);
      const type = allowedTypes.has(raw?.type) ? raw.type : 'choice';
      const prompt = String(raw?.prompt || '').trim().slice(0, 500);
      if (!prompt) {
        cb?.({ ok: false, error: 'Add a question first' });
        return;
      }
      let options = Array.isArray(raw?.options)
        ? raw.options.map((value) => String(value || '').trim().slice(0, 120)).filter(Boolean).slice(0, 6)
        : [];
      if (type === 'truefalse') options = ['True', 'False'];
      if (type === 'rating') options = ['1', '2', '3', '4', '5'];
      if (type === 'choice' && options.length < 2) {
        cb?.({ ok: false, error: 'Add at least two answer choices' });
        return;
      }
      const requestedCorrectAnswer = String(raw?.correctAnswer || '').trim().slice(0, 120);
      const correctAnswer = type !== 'short' && options.includes(requestedCorrectAnswer)
        ? requestedCorrectAnswer
        : '';
      const activity = queries.launchLiveActivity(db, code, {
        id: randomUUID(),
        type,
        prompt,
        options,
        correctAnswer,
        anonymous: !!raw?.anonymous,
        optional: !!raw?.optional,
      });
      if (!activity.optional) queries.addLiveOpportunity(db, connectedStudentsInRoom(code));
      emitLiveState(code);
      cb?.({ ok: true, activity });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not launch the question' });
    }
  });

  socket.on('student:live-response', ({ activityId, value }, cb) => {
    try {
      const code = socket.data.roomCode;
      const sid = Number(socket.data.studentId);
      if (socket.data.role !== 'student' || !code || !sid) {
        cb?.({ ok: false, error: 'Join the room first' });
        return;
      }
      const activity = queries.getLiveActivity(db, code);
      if (!activity || activity.id !== String(activityId || '')) {
        cb?.({ ok: false, error: 'That question has finished' });
        return;
      }
      if (activity.locked) {
        cb?.({ ok: false, error: 'Answers are locked' });
        return;
      }
      const answer = String(value ?? '').trim().slice(0, activity.type === 'short' ? 500 : 120);
      if (!answer) {
        cb?.({ ok: false, error: 'Choose or enter an answer' });
        return;
      }
      if (activity.type !== 'short' && !activity.options.includes(answer)) {
        cb?.({ ok: false, error: 'Choose one of the available answers' });
        return;
      }
      queries.upsertLiveResponse(db, { activityId: activity.id, roomCode: code, studentId: sid, value: answer });
      if (!activity.optional) queries.markLiveResponse(db, sid);
      emitLiveState(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not send the answer' });
    }
  });

  socket.on('student:live-status', ({ status }, cb) => {
    try {
      const code = socket.data.roomCode;
      const sid = Number(socket.data.studentId);
      if (socket.data.role !== 'student' || !code || !sid) {
        cb?.({ ok: false });
        return;
      }
      queries.setStudentEngagementStatus(db, sid, status);
      io.to(teacherSocketName(code)).emit('live:teacher', buildTeacherLivePayload(code));
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:live-control', ({ action }, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false });
        return;
      }
      if (action === 'clear') queries.clearLiveActivity(db, code);
      else if (action === 'lock') queries.updateLiveActivity(db, code, { locked: true });
      else if (action === 'unlock') queries.updateLiveActivity(db, code, { locked: false });
      else if (action === 'reveal') queries.updateLiveActivity(db, code, { revealed: true });
      else {
        cb?.({ ok: false, error: 'Unknown action' });
        return;
      }
      emitLiveState(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:live-publish', ({ activityId, studentId, published }, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false });
        return;
      }
      const activity = queries.getLiveActivity(db, code);
      if (!activity || activity.id !== String(activityId || '') || activity.type !== 'short') {
        cb?.({ ok: false });
        return;
      }
      queries.setLiveResponsePublished(db, code, activity.id, Number(studentId), !!published);
      emitLiveState(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:live-nudge', ({ studentId }, cb) => {
    const code = socket.data.roomCode;
    const sid = Number(studentId);
    const row = sid ? queries.getStudent(db, sid) : null;
    if (
      socket.data.role !== 'teacher' ||
      !code ||
      !row ||
      normalizeRoomCode(row.room_code) !== normalizeRoomCode(code)
    ) {
      cb?.({ ok: false });
      return;
    }
    queries.setStudentEngagementStatus(db, sid, '');
    io.to(studentSocketName(sid)).emit('live:nudge', { message: 'Are you still with us?' });
    io.to(teacherSocketName(code)).emit('live:teacher', buildTeacherLivePayload(code));
    cb?.({ ok: true });
  });

  socket.on('teacher:live-realert', (_payload, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false });
        return;
      }
      const activity = queries.getLiveActivity(db, code);
      if (!activity) {
        cb?.({ ok: false, error: 'There is no live question' });
        return;
      }
      const answered = new Set(
        queries.listLiveResponses(db, code).map((response) => Number(response.studentId))
      );
      const targets = connectedStudentsInRoom(code).filter((studentId) => !answered.has(studentId));
      for (const studentId of targets) {
        io.to(studentSocketName(studentId)).emit('live:realert', {
          activity: publicLiveActivity(activity),
        });
      }
      cb?.({ ok: true, count: targets.length });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not re-alert students' });
    }
  });

  socket.on('student:text', ({ text }, cb) => {
    try {
      const sid = socket.data.studentId;
      const code = socket.data.roomCode;
      if (!sid || !code) {
        cb?.({ ok: false });
        return;
      }
      const roomRow = queries.ensureRoom(db, code);
      let t = String(text ?? '');
      if (roomRow.enforce_word_count && roomRow.word_target > 0) {
        t = truncateToWordLimit(t, roomRow.word_target);
      }
      // Cap payload size so one huge paste cannot stall every teacher/iBoard client
      if (t.length > 50_000) t = t.slice(0, 50_000);
      const row = queries.updateStudentText(db, sid, t);
      const student = queries.rowToStudent(row);
      // Live patch only — do NOT broadcastRoom() here. Full room:state on every
      // 2s sync × N students freezes teacher dashboard / iBoard with large classes.
      io.to(roomSocketName(code)).emit('student:live', { student });
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('student:image', ({ imageBase64, mimeType }, cb) => {
    try {
      const sid = socket.data.studentId;
      const codeRaw = socket.data.roomCode;
      if (!sid || !codeRaw || socket.data.role !== 'student') {
        cb?.({ ok: false, error: 'Not joined as student' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const roomRow = queries.ensureRoom(db, code);
      if (roomRow.freeze_class) {
        cb?.({ ok: false, error: 'Class is frozen' });
        return;
      }
      const decoded = decodeImageBase64(imageBase64, mimeType);
      if (decoded.error) {
        cb?.({ ok: false, error: decoded.error });
        return;
      }
      const existing = queries.getStudent(db, sid);
      if (!existing || normalizeRoomCode(existing.room_code) !== code) {
        cb?.({ ok: false, error: 'Session expired' });
        return;
      }
      if (existing.image_filename) unlinkRoomMedia(code, existing.image_filename);
      const filename = `s${sid}-${Date.now()}.${decoded.ext}`;
      fs.writeFileSync(path.join(boardMediaDir(code), filename), decoded.buf);
      const row = queries.updateStudentImage(db, sid, filename);
      const student = queries.rowToStudent(row);
      io.to(roomSocketName(code)).emit('student:live', { student });
      cb?.({ ok: true, student });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not save image' });
    }
  });

  socket.on('student:image-clear', (_payload, cb) => {
    try {
      const sid = socket.data.studentId;
      const codeRaw = socket.data.roomCode;
      if (!sid || !codeRaw || socket.data.role !== 'student') {
        cb?.({ ok: false });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const existing = queries.getStudent(db, sid);
      if (!existing || normalizeRoomCode(existing.room_code) !== code) {
        cb?.({ ok: false });
        return;
      }
      if (existing.image_filename) unlinkRoomMedia(code, existing.image_filename);
      const row = queries.updateStudentImage(db, sid, '');
      const student = queries.rowToStudent(row);
      io.to(roomSocketName(code)).emit('student:live', { student });
      cb?.({ ok: true, student });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:settings', (settings, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false });
        return;
      }
      let payload = settings && typeof settings === 'object' ? { ...settings } : settings;
      if (payload?.feedback_toggles && 'teacherYearLevel' in payload) {
        const raw = payload.teacherYearLevel;
        const yl =
          raw == null || String(raw).trim() === '' ? 'general' : String(raw).trim().slice(0, 48);
        payload = {
          ...payload,
          feedback_toggles: { ...payload.feedback_toggles, yearLevel: yl },
        };
        delete payload.teacherYearLevel;
      }
      queries.updateRoomSettings(db, code, payload);
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:distribute', ({ items }, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false });
        return;
      }
      const list = Array.isArray(items) ? items : [];
      io.to(roomSocketName(code)).emit('feedback:batch', { items: list });
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:student-group', ({ studentId, class_group }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const sid = Number(studentId);
      if (!sid) {
        cb?.({ ok: false });
        return;
      }
      const row = queries.getStudent(db, sid);
      if (!row || normalizeRoomCode(row.room_code) !== code) {
        cb?.({ ok: false });
        return;
      }
      queries.updateStudentGroup(db, sid, class_group);
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:student-year', ({ studentId, year_level }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const sid = Number(studentId);
      if (!sid) {
        cb?.({ ok: false });
        return;
      }
      const row = queries.getStudent(db, sid);
      if (!row || normalizeRoomCode(row.room_code) !== code) {
        cb?.({ ok: false });
        return;
      }
      queries.updateStudentYearLevel(db, sid, year_level);
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('student:year', ({ year_level }, cb) => {
    try {
      const sid = socket.data.studentId;
      const code = socket.data.roomCode;
      if (socket.data.role !== 'student' || !sid || !code) {
        cb?.({ ok: false, error: 'Join the room first' });
        return;
      }
      const row = queries.getStudent(db, sid);
      if (!row || normalizeRoomCode(row.room_code) !== normalizeRoomCode(code)) {
        cb?.({ ok: false, error: 'Session expired — join again' });
        return;
      }
      const updated = queries.updateStudentYearLevel(db, sid, year_level);
      const student = queries.rowToStudent(updated);
      broadcastRoom(normalizeRoomCode(code));
      cb?.({ ok: true, student });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not save year level' });
    }
  });

  socket.on('teacher:student-remove', ({ studentId }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const sid = Number(studentId);
      if (!sid) {
        cb?.({ ok: false });
        return;
      }
      const row = queries.getStudent(db, sid);
      if (!row || normalizeRoomCode(row.room_code) !== code) {
        cb?.({ ok: false, error: 'Student not found' });
        return;
      }
      queries.deleteStudent(db, sid);
      if (row.image_filename) unlinkRoomMedia(code, row.image_filename);
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not remove student' });
    }
  });

  socket.on('teacher:times-up', (_payload, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      io.to(roomSocketName(code)).emit('timer:times-up', { at: Date.now() });
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:broadcast', async ({ studentIds, postIds }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false, error: 'Open the room again as teacher (socket not in room)' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const rawStudents = Array.isArray(studentIds) ? studentIds : [];
      const rawPosts = Array.isArray(postIds) ? postIds : [];
      const sIds = [];
      const pIds = [];
      const seenS = new Set();
      const seenP = new Set();
      for (const x of rawStudents) {
        const n = Number(x);
        if (n > 0 && !seenS.has(n)) {
          seenS.add(n);
          sIds.push(n);
        }
      }
      for (const x of rawPosts) {
        const n = Number(x);
        if (n > 0 && !seenP.has(n)) {
          seenP.add(n);
          pIds.push(n);
        }
      }
      if (!sIds.length && !pIds.length) {
        cb?.({ ok: false, error: 'Select at least one card' });
        return;
      }
      const items = [];
      const pushCap = () => items.length >= 6;

      for (const id of pIds) {
        if (pushCap()) break;
        const row = queries.getBoardPost(db, id);
        if (!row || normalizeRoomCode(row.room_code) !== code) continue;
        const post = queries.rowToBoardPost(row);
        const text = String(post.text || '').slice(0, 14_000);
        const image_url = post.image_url || null;
        if (!text.trim() && !image_url) continue;
        const label = `Exemplar ${String.fromCharCode(65 + items.length)}`;
        items.push({ label, text, image_url, from: 'teacher' });
      }
      for (const id of sIds) {
        if (pushCap()) break;
        const row = queries.getStudent(db, id);
        if (!row || normalizeRoomCode(row.room_code) !== code) continue;
        const student = queries.rowToStudent(row);
        const text = String(row.text || '').slice(0, 14_000);
        const image_url = student.image_url || null;
        if (!text.trim() && !image_url) continue;
        const label = `Exemplar ${String.fromCharCode(65 + items.length)}`;
        items.push({ label, text, image_url, from: 'student' });
      }
      if (!items.length) {
        cb?.({
          ok: false,
          error: 'Selected cards have no writing or images yet',
        });
        return;
      }
      const payload = { items, at: Date.now() };
      emitBroadcastToRoom(code, payload);
      const sockets = await io.in(roomSocketName(code)).fetchSockets();
      const studentSockets = sockets.filter((s) => s.data?.role === 'student');
      cb?.({
        ok: true,
        count: items.length,
        reached: studentSockets.length,
        devices: sockets.length,
      });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Broadcast failed' });
    }
  });

  socket.on('teacher:snapshot-save', ({ label }, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false });
        return;
      }
      const rows = queries.listStudents(db, code);
      const payload = {
        room_code: code,
        saved_at: new Date().toISOString(),
        students: rows.map((s) => ({
          id: s.id,
          name: s.name,
          class_group: s.class_group != null ? String(s.class_group) : '',
          text: s.text || '',
          updated_at: s.updated_at,
        })),
      };
      const lab =
        String(label || '')
          .trim()
          .slice(0, 200) || `Snapshot ${new Date().toLocaleString()}`;
      const id = queries.addSnapshot(db, code, lab, payload);
      const snapshots = queries.listSnapshotMeta(db, code);
      cb?.({ ok: true, id, snapshots });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:board-post', ({ kind, title, text, imageBase64, mimeType }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const k = kind === 'image' ? 'image' : 'text';
      const lab = String(title || 'Teacher').trim().slice(0, 80) || 'Teacher';

      if (k === 'text') {
        const body = String(text || '').trim();
        if (!body) {
          cb?.({ ok: false, error: 'Add some text for the card' });
          return;
        }
        queries.addBoardPost(db, code, { kind: 'text', title: lab, text: body, image_filename: '' });
        broadcastRoom(code);
        cb?.({ ok: true });
        return;
      }

      const raw = String(imageBase64 || '');
      const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
      if (!b64 || b64.length < 32) {
        cb?.({ ok: false, error: 'No image data' });
        return;
      }
      // ~2MB decoded max
      if (b64.length > 2.8e6) {
        cb?.({ ok: false, error: 'Image too large — try a smaller screenshot' });
        return;
      }
      const mime = String(mimeType || 'image/jpeg').toLowerCase();
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) {
        cb?.({ ok: false, error: 'Could not read image' });
        return;
      }
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      fs.writeFileSync(path.join(boardMediaDir(code), filename), buf);
      queries.addBoardPost(db, code, {
        kind: 'image',
        title: lab,
        text: '',
        image_filename: filename,
      });
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not save card' });
    }
  });

  socket.on('teacher:board-post-delete', ({ postId }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const id = Number(postId);
      if (!id) {
        cb?.({ ok: false });
        return;
      }
      const row = queries.getBoardPost(db, id);
      if (!row || normalizeRoomCode(row.room_code) !== code) {
        cb?.({ ok: false });
        return;
      }
      queries.deleteBoardPost(db, id);
      if (row.image_filename) unlinkRoomMedia(code, row.image_filename);
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:board-post-size', ({ postId, size }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const id = Number(postId);
      if (!id) {
        cb?.({ ok: false });
        return;
      }
      const row = queries.getBoardPost(db, id);
      if (!row || normalizeRoomCode(row.room_code) !== code) {
        cb?.({ ok: false });
        return;
      }
      queries.updateBoardPostSize(db, id, size);
      broadcastRoom(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:clear-cards', (_payload, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      // Delete students entirely so reused room codes don't keep ghost cards
      const studentRows = queries.deleteAllStudents(db, code);
      for (const s of studentRows) {
        if (s.image_filename) unlinkRoomMedia(code, s.image_filename);
      }
      const postRows = queries.deleteAllBoardPosts(db, code);
      for (const p of postRows) {
        if (p.image_filename) unlinkRoomMedia(code, p.image_filename);
      }
      lastBroadcastByRoom.delete(code);
      queries.clearLiveActivity(db, code);
      queries.resetLiveQuestionNumber(db, code);
      broadcastRoom(code);
      emitLiveState(code);
      cb?.({
        ok: true,
        clearedStudents: studentRows.length,
        clearedPosts: postRows.length,
      });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not clear cards' });
    }
  });

  socket.on('disconnect', () => {
    const sid = Number(socket.data.studentId);
    const code = socket.data.roomCode;
    if (sid) removeStudentPresence(sid, socket.id);
    if (code) io.to(teacherSocketName(code)).emit('live:teacher', buildTeacherLivePayload(code));
  });
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`iBOARD server on http://0.0.0.0:${PORT}`);
});
