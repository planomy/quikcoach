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
app.use(express.json({ limit: '8mb' }));

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

function normalizeStudentName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function buildEvidenceStudentProfiles(code) {
  const aliasByKey = new Map(
    queries.listReportAliases(db, code).map((row) => [String(row.alias_key), row])
  );
  const grouped = new Map();

  for (const snapshot of queries.listSnapshots(db, code)) {
    const rows = Array.isArray(snapshot.payload?.students) ? snapshot.payload.students : [];
    for (const student of rows) {
      const name = String(student?.name || '').trim().replace(/\s+/g, ' ');
      const text = String(student?.text || '').trim();
      if (!name || !text) continue;

      const rawKey = normalizeStudentName(name);
      const alias = aliasByKey.get(rawKey);
      const key = String(alias?.canonical_key || rawKey);
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          name: String(alias?.canonical_name || name),
          aliases: new Set(),
          sourceKeys: new Set(),
          entries: [],
          seen: new Set(),
        });
      }
      const profile = grouped.get(key);
      profile.aliases.add(name);
      profile.sourceKeys.add(rawKey);
      const duplicateKey = `${String(student.updated_at || '')}\u0000${text}`;
      if (profile.seen.has(duplicateKey)) continue;
      profile.seen.add(duplicateKey);
      profile.entries.push({
        snapshotId: Number(snapshot.id),
        label: snapshot.label || `Evidence #${snapshot.id}`,
        createdAt: snapshot.created_at,
        studentId: Number(student.id) || null,
        updatedAt: student.updated_at || '',
        classGroup: student.class_group != null ? String(student.class_group) : '',
        sourceName: name,
        text,
      });
    }
  }

  return [...grouped.values()]
    .map((profile) => ({
      key: profile.key,
      name: profile.name,
      aliases: [...profile.aliases].sort((a, b) => a.localeCompare(b)),
      combined: profile.sourceKeys.size > 1,
      entries: profile.entries,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

const MATERIAL_MAX_BYTES = 5 * 1024 * 1024;
const MATERIAL_HISTORY_LIMIT = 20;
/** Teacher handouts pushed to student Inbox for the current lesson. */
const materialHistoryByRoom = new Map();

const MATERIAL_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function extFromName(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : '';
}

function mimeFromExt(ext) {
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return map[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

function decodeMaterialBase64(fileBase64, mimeType, originalName) {
  const raw = String(fileBase64 || '');
  const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
  if (!b64 || b64.length < 32) return { error: 'No file data' };
  let buf;
  try {
    buf = Buffer.from(b64.replace(/\s/g, ''), 'base64');
  } catch {
    return { error: 'Could not read that file' };
  }
  if (!buf.length) return { error: 'Could not read that file' };
  if (buf.length > MATERIAL_MAX_BYTES) return { error: 'File too large — keep under 5 MB' };

  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  let ext = MATERIAL_TYPES[mime] || '';
  if (!ext) {
    const fromName = extFromName(originalName);
    if (['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(fromName)) {
      ext = fromName === 'jpeg' ? 'jpg' : fromName;
    }
  }
  if (!ext) return { error: 'Use a PDF or image — Word and PowerPoint can’t be previewed in class' };
  return { buf, ext, mime: mimeFromExt(ext) };
}

function materialHistoryForRoom(code) {
  return materialHistoryByRoom.get(normalizeRoomCode(code)) || [];
}

function emitMaterialHistoryToSocket(socket, code) {
  const history = materialHistoryForRoom(code);
  if (!history.length) return;
  socket.emit('inbox:material', { history, replay: true });
}

function emitMaterialToRoom(code, item) {
  const c = normalizeRoomCode(code);
  const history = [...materialHistoryForRoom(c), item].slice(-MATERIAL_HISTORY_LIMIT);
  materialHistoryByRoom.set(c, history);
  io.to(roomSocketName(c)).emit('inbox:material', { item, history });
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

app.get('/api/rooms/:code/lesson-report', (req, res) => {
  try {
    const code = String(req.params.code || '')
      .replace(/\D/g, '')
      .slice(0, 4)
      .padStart(4, '0');
    if (code.length !== 4) return res.status(400).json({ error: 'Invalid room' });
    queries.ensureRoom(db, code);
    res.json(queries.buildLessonReport(db, code));
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

app.get('/api/rooms/:code/evidence-students', (req, res) => {
  try {
    const code = String(req.params.code || '')
      .replace(/\D/g, '')
      .slice(0, 4)
      .padStart(4, '0');
    if (code.length !== 4) return res.status(400).json({ error: 'Invalid room' });
    queries.ensureRoom(db, code);
    res.json({ students: buildEvidenceStudentProfiles(code) });
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
    const ext = extFromName(filename);
    res.type(mimeFromExt(ext));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (String(req.query.download || '') === '1') {
      const downloadName = safeMediaFilename(req.query.name) || filename;
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    }
    res.sendFile(filePath);
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

/** Pulse question images — keep Socket.IO payloads small; browsers load via HTTP. */
app.get('/api/live-activities/:id/image', (req, res) => {
  try {
    const activity = queries.getLiveActivityById(db, req.params.id);
    const dataUrl = String(activity?.imageUrl || '');
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type(match[1]);
    res.send(Buffer.from(match[2].replace(/\s/g, ''), 'base64'));
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 10e6,
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

const BROADCAST_HISTORY_LIMIT = 10;
/** Current-lesson broadcast history per room. Cleared with teacher:clear-cards. */
const broadcastHistoryByRoom = new Map();

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

/** Keep base64 in SQLite; send students/teachers a small HTTP URL over Socket.IO. */
function liveActivityForClients(activity) {
  if (!activity) return null;
  const hasImage = !!(activity.imageUrl && String(activity.imageUrl).startsWith('data:image/'));
  return {
    ...activity,
    imageUrl: hasImage
      ? `/api/live-activities/${encodeURIComponent(activity.id)}/image`
      : '',
  };
}

function publicLiveActivity(activity) {
  if (!activity) return null;
  const wired = liveActivityForClients(activity);
  const { correctAnswer, ...safe } = wired;
  return {
    ...safe,
    correctAnswer: activity.revealed ? correctAnswer : '',
  };
}

/** Original asker is excluded when a student question is Shared to the room. */
function sourceStudentIdForActivity(activity) {
  const sourceQuestionId = Number(activity?.sourceQuestionId) || 0;
  if (!sourceQuestionId) return 0;
  const question = queries.getAudienceQuestion(db, sourceQuestionId);
  return question ? Number(question.student_id) || 0 : 0;
}

function activityForStudent(activity, studentId) {
  if (!activity) return null;
  const excludedId = sourceStudentIdForActivity(activity);
  if (excludedId && Number(studentId) === excludedId) return null;
  return activity;
}

function buildTeacherLivePayload(code) {
  const c = normalizeRoomCode(code);
  const activity = liveActivityForClients(queries.getLiveActivity(db, c));
  const responses = activity ? queries.listLiveResponses(db, c) : [];
  const responseByStudent = new Map(responses.map((response) => [response.studentId, response]));
  const excludedStudentId = sourceStudentIdForActivity(activity);
  const awareness = queries.getLessonPulseAwareness(db, c);
  const questionByActivity = new Map(awareness.questions.map((question) => [question.activityId, question]));
  const cellByStudentAndActivity = new Map(
    awareness.cells.map((cell) => [`${cell.studentId}:${cell.activityId}`, cell])
  );
  const opportunitiesByStudent = new Map();
  for (const opportunity of awareness.opportunities) {
    opportunitiesByStudent.set(
      opportunity.studentId,
      [...(opportunitiesByStudent.get(opportunity.studentId) || []), opportunity]
    );
  }
  const allStudents = queries.listStudents(db, c).map((row) => {
    const student = queries.rowToStudent(row);
    const opportunityCount = Number(student.engagement?.opportunities || 0);
    const exactOpportunities = opportunitiesByStudent.get(Number(student.id)) || [];
    const exactHistoryComplete = opportunityCount > 0 && exactOpportunities.length === opportunityCount;
    const relevantQuestions = opportunityCount <= 0
      ? []
      : exactHistoryComplete
        ? exactOpportunities
            .map((opportunity) => questionByActivity.get(opportunity.activityId) || opportunity)
            .sort((a, b) => (a.order ?? a.questionNumber) - (b.order ?? b.questionNumber))
        : awareness.questions.slice(-opportunityCount);
    const segments = relevantQuestions.map((question) => {
      const cell = cellByStudentAndActivity.get(`${student.id}:${question.activityId}`);
      return {
        questionNumber: Number(question.questionNumber) || 1,
        answered: !!cell,
        confidence: cell?.confidence || '',
      };
    });
    const promptExcluded = excludedStudentId > 0 && Number(student.id) === excludedStudentId;
    return {
      id: student.id,
      name: student.name,
      year_level: student.year_level,
      connected: isStudentConnected(student.id),
      engagement_status: student.engagement_status,
      engagement: { ...student.engagement, segments },
      hasResponded: responseByStudent.has(student.id),
      promptExcluded,
      response: responseByStudent.get(student.id) || null,
    };
  });
  const groups = new Map();
  for (const student of allStudents) {
    const key = normalizeStudentName(student.name);
    groups.set(key, [...(groups.get(key) || []), student]);
  }
  const students = [...groups.values()].flatMap((matches) => {
    if (matches.length === 1) return matches;
    const connected = matches.filter((student) => student.connected);
    // Preserve genuinely different same-name students while both are present.
    if (connected.length > 1) return matches;
    const best = [...matches].sort((a, b) => {
      if (Number(b.connected) !== Number(a.connected)) return Number(b.connected) - Number(a.connected);
      if (Number(b.hasResponded) !== Number(a.hasResponded)) return Number(b.hasResponded) - Number(a.hasResponded);
      if (b.engagement.opportunities !== a.engagement.opportunities) return b.engagement.opportunities - a.engagement.opportunities;
      if (b.engagement.responded !== a.engagement.responded) return b.engagement.responded - a.engagement.responded;
      return Number(b.id) - Number(a.id);
    })[0];
    return [best];
  });
  const visibleIds = new Set(students.map((student) => student.id));
  const visibleResponses = responses.filter((response) => visibleIds.has(response.studentId));
  return { activity, responses: visibleResponses, students, featuredWall: queries.listFeaturedWall(db, c), serverNow: Date.now() };
}

function emitStudentLiveState(code, studentId) {
  const c = normalizeRoomCode(code);
  const activity = activityForStudent(queries.getLiveActivity(db, c), studentId);
  const responses = activity ? queries.listLiveResponses(db, c) : [];
  const own = responses.find((response) => response.studentId === Number(studentId)) || null;
  io.to(studentSocketName(studentId)).emit('live:student', {
    activity: publicLiveActivity(activity),
    response: own ? { value: own.value, confidence: own.confidence, submittedAt: own.submittedAt } : null,
    serverNow: Date.now(),
  });
}

function emitLiveState(code) {
  const c = normalizeRoomCode(code);
  let activity = null;
  let responses = [];
  let featured = [];
  try {
    const teacherPayload = buildTeacherLivePayload(c);
    io.to(teacherSocketName(c)).emit('live:teacher', teacherPayload);
    activity = teacherPayload.activity;
    responses = teacherPayload.responses || [];
    const featuredLabels = new Map(
      (teacherPayload.featuredWall || [])
        .filter((item) => String(item.activityId) === String(activity?.id))
        .map((item) => [Number(item.studentId), String(item.label || '')])
    );
    featured = activity?.type === 'short'
      ? responses.filter((response) => response.published).map((response) => ({
          value: response.value,
          name: activity.anonymous ? 'Anonymous' : response.name,
          label: featuredLabels.get(Number(response.studentId)) || '',
        }))
      : [];
  } catch (teacherLiveError) {
    console.error(teacherLiveError);
    activity = liveActivityForClients(queries.getLiveActivity(db, c));
    responses = activity ? queries.listLiveResponses(db, c) : [];
  }

  // Every roster student gets a personalised payload (excludes Shared asker).
  for (const row of queries.listStudents(db, c)) {
    const sid = Number(row.id);
    if (!sid) continue;
    try {
      const visible = activityForStudent(activity, sid);
      io.to(studentSocketName(sid)).emit('live:activity', {
        activity: publicLiveActivity(visible),
        responseCount: responses.length,
        featured: visible ? featured : [],
        serverNow: Date.now(),
      });
      emitStudentLiveState(c, sid);
    } catch (studentLiveError) {
      console.error(studentLiveError);
    }
  }
}

const UNKNOWN_ANSWER = '__iboard_unknown__';

function formatLiveAnswer(value) {
  return String(value || '') === UNKNOWN_ANSWER ? "I don't know" : String(value || '');
}

function audienceQuestionBase(row) {
  return {
    id: Number(row.id),
    text: String(row.text || ''),
    status: String(row.status || 'pending'),
    votes: Number(row.vote_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildTeacherQnaPayload(code) {
  const c = normalizeRoomCode(code);
  return {
    questions: queries.listAudienceQuestions(db, c).map((row) => ({
      ...audienceQuestionBase(row),
      studentId: Number(row.student_id),
      studentName: String(row.student_name || ''),
      anonymousRequested: !!row.anonymous_requested,
      publishedAnonymous: !!row.published_anonymous,
    })),
  };
}

function buildStudentQnaPayload(code, studentId) {
  const c = normalizeRoomCode(code);
  const sid = Number(studentId);
  const questions = queries.listAudienceQuestions(db, c).flatMap((row) => {
    const mine = Number(row.student_id) === sid;
    if (!mine) return [];
    const anonymous = !!row.anonymous_requested;
    return [{
      ...audienceQuestionBase(row),
      mine: true,
      anonymous,
      author: 'You',
      voted: false,
    }];
  });
  return { questions };
}

function emitAudienceQnaState(code) {
  const c = normalizeRoomCode(code);
  io.to(teacherSocketName(c)).emit('qna:teacher', buildTeacherQnaPayload(c));
  for (const row of queries.listStudents(db, c)) {
    io.to(studentSocketName(row.id)).emit('qna:student', buildStudentQnaPayload(c, row.id));
  }
}

function connectedStudentsInRoom(code) {
  const c = normalizeRoomCode(code);
  return queries
    .listStudents(db, c)
    .map((row) => Number(row.id))
    .filter(isStudentConnected);
}

function broadcastHistoryForRoom(code) {
  return broadcastHistoryByRoom.get(normalizeRoomCode(code)) || [];
}

function emitBroadcastHistoryToSocket(socket, code) {
  const history = broadcastHistoryForRoom(code);
  if (!history.length) return;
  const latest = history[history.length - 1];
  socket.emit('broadcast:exemplars', { ...latest, history });
}

function emitBroadcastToRoom(code, payload) {
  const c = normalizeRoomCode(code);
  const room = roomSocketName(c);
  const history = [...broadcastHistoryForRoom(c), payload].slice(-BROADCAST_HISTORY_LIMIT);
  broadcastHistoryByRoom.set(c, history);
  io.to(room).emit('broadcast:exemplars', { ...payload, history });
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
      try {
        socket.emit('live:teacher', buildTeacherLivePayload(c));
      } catch (liveError) {
        console.error(liveError);
      }
      try {
        socket.emit('qna:teacher', buildTeacherQnaPayload(c));
      } catch (qnaError) {
        console.error(qnaError);
      }
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
      const sameName = queries.listStudents(db, c).filter(
        (row) => normalizeStudentName(row.name) === normalizeStudentName(n)
      );
      const disconnectedMatches = sameName.filter((row) => !isStudentConnected(row.id));
      let studentRow = null;
      let resumed = false;

      if (disconnectedMatches.length) {
        // Older rooms may already contain duplicate ghost rows. Prefer the card with
        // the strongest engagement history, then the most recently active card.
        const currentResponseIds = new Set(
          queries.listLiveResponses(db, c).map((response) => response.studentId)
        );
        studentRow = [...disconnectedMatches].sort((a, b) => {
          if (Number(currentResponseIds.has(b.id)) !== Number(currentResponseIds.has(a.id))) {
            return Number(currentResponseIds.has(b.id)) - Number(currentResponseIds.has(a.id));
          }
          const aRecent = queries.rowToStudent(a).engagement;
          const bRecent = queries.rowToStudent(b).engagement;
          if (bRecent.opportunities !== aRecent.opportunities) return bRecent.opportunities - aRecent.opportunities;
          if (bRecent.responded !== aRecent.responded) return bRecent.responded - aRecent.responded;
          const activeOrder = String(b.last_engaged_at || '').localeCompare(String(a.last_engaged_at || ''));
          return activeOrder || Number(b.id) - Number(a.id);
        })[0];
        resumed = true;
      } else if (sameName.length) {
        cb?.({
          ok: false,
          error: 'That name is already connected. If it is another student, add your surname initial.',
        });
        return;
      } else {
        studentRow = queries.addStudent(db, c, n);
      }
      const student = queries.rowToStudent(studentRow);
      socket.join(roomSocketName(c));
      socket.join(studentSocketName(student.id));
      socket.data.role = 'student';
      socket.data.roomCode = c;
      socket.data.studentId = student.id;
      addStudentPresence(student.id, socket.id);
      const payload = buildRoomPayload(c);
      cb?.({ ok: true, student, room: payload.room, students: payload.students, resumed });
      try {
        emitRoomState(c, payload);
        emitBroadcastHistoryToSocket(socket, c);
        emitMaterialHistoryToSocket(socket, c);
        emitLiveState(c);
        emitAudienceQnaState(c);
      } catch (postJoinError) {
        // Never fail the join ack after success — live extras can recover on sync.
        console.error(postJoinError);
      }
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
      try {
        emitRoomState(c, payload);
        emitBroadcastHistoryToSocket(socket, c);
        emitMaterialHistoryToSocket(socket, c);
        emitLiveState(c);
        emitAudienceQnaState(c);
      } catch (postJoinError) {
        console.error(postJoinError);
      }
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

  socket.on('teacher:qna-sync', (_payload, cb) => {
    const code = socket.data.roomCode;
    if (socket.data.role !== 'teacher' || !code) {
      cb?.({ ok: false });
      return;
    }
    socket.emit('qna:teacher', buildTeacherQnaPayload(code));
    cb?.({ ok: true });
  });

  socket.on('student:qna-sync', (_payload, cb) => {
    const code = socket.data.roomCode;
    const sid = Number(socket.data.studentId);
    if (socket.data.role !== 'student' || !code || !sid) {
      cb?.({ ok: false });
      return;
    }
    socket.emit('qna:student', buildStudentQnaPayload(code, sid));
    cb?.({ ok: true });
  });

  socket.on('student:qna-submit', ({ text, anonymous }, cb) => {
    try {
      const code = socket.data.roomCode;
      const sid = Number(socket.data.studentId);
      if (socket.data.role !== 'student' || !code || !sid) {
        cb?.({ ok: false, error: 'Join the room first' });
        return;
      }
      const student = queries.getStudent(db, sid);
      if (!student || normalizeRoomCode(student.room_code) !== normalizeRoomCode(code)) {
        cb?.({ ok: false, error: 'Your session has expired' });
        return;
      }
      const questionText = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
      if (!questionText) {
        cb?.({ ok: false, error: 'Write a question first' });
        return;
      }
      if (queries.countOpenAudienceQuestions(db, code, sid) >= 3) {
        cb?.({ ok: false, error: 'You already have three open questions' });
        return;
      }
      queries.addAudienceQuestion(db, {
        roomCode: normalizeRoomCode(code),
        studentId: sid,
        studentName: student.name,
        text: questionText,
        anonymousRequested: !!anonymous,
      });
      emitAudienceQnaState(code);
      cb?.({ ok: true });
    } catch (error) {
      console.error(error);
      cb?.({ ok: false, error: 'Could not send the question' });
    }
  });

  socket.on('student:qna-vote', ({ questionId }, cb) => {
    try {
      const code = socket.data.roomCode;
      const sid = Number(socket.data.studentId);
      const question = queries.getAudienceQuestion(db, Number(questionId));
      const isPublic = question?.status === 'published' || question?.status === 'answered';
      if (
        socket.data.role !== 'student' || !code || !sid || !question || !isPublic ||
        normalizeRoomCode(question.room_code) !== normalizeRoomCode(code)
      ) {
        cb?.({ ok: false, error: 'That question is not available' });
        return;
      }
      if (Number(question.student_id) === sid) {
        cb?.({ ok: false, error: 'You cannot vote for your own question' });
        return;
      }
      const voted = queries.toggleAudienceQuestionVote(db, question.id, sid);
      emitAudienceQnaState(code);
      cb?.({ ok: true, voted });
    } catch (error) {
      console.error(error);
      cb?.({ ok: false, error: 'Could not update your vote' });
    }
  });

  socket.on('teacher:qna-status', ({ questionId, action, anonymous }, cb) => {
    try {
      const code = socket.data.roomCode;
      const question = queries.getAudienceQuestion(db, Number(questionId));
      if (
        socket.data.role !== 'teacher' || !code || !question ||
        normalizeRoomCode(question.room_code) !== normalizeRoomCode(code)
      ) {
        cb?.({ ok: false, error: 'Question not found' });
        return;
      }
      const nextStatus = {
        publish: 'published',
        answer: 'answered',
        dismiss: 'dismissed',
        pending: 'pending',
        reopen: 'published',
      }[String(action || '')];
      if (!nextStatus) {
        cb?.({ ok: false, error: 'Unknown action' });
        return;
      }
      const publishedAnonymous = action === 'publish'
        ? anonymous === undefined ? !!question.anonymous_requested : !!anonymous
        : !!question.published_anonymous;
      queries.setAudienceQuestionStatus(db, code, question.id, nextStatus, publishedAnonymous);
      emitAudienceQnaState(code);
      cb?.({ ok: true });
    } catch (error) {
      console.error(error);
      cb?.({ ok: false, error: 'Could not update the question' });
    }
  });

  socket.on('teacher:qna-ask-room', ({ questionId, anonymous }, cb) => {
    try {
      const code = socket.data.roomCode;
      const question = queries.getAudienceQuestion(db, Number(questionId));
      if (
        socket.data.role !== 'teacher' || !code || !question ||
        normalizeRoomCode(question.room_code) !== normalizeRoomCode(code)
      ) {
        cb?.({ ok: false, error: 'Question not found' });
        return;
      }
      const publishedAnonymous = anonymous === undefined
        ? !!question.anonymous_requested
        : !!anonymous;
      queries.setAudienceQuestionStatus(db, code, question.id, 'published', publishedAnonymous);
      const activity = queries.launchLiveActivity(db, code, {
        id: randomUUID(),
        type: 'short',
        prompt: question.text,
        options: [],
        correctAnswer: '',
        anonymous: publishedAnonymous,
        optional: false,
        imageUrl: '',
        timerSeconds: 0,
        sourceQuestionId: question.id,
      });
      const askerId = Number(question.student_id);
      const shareTargets = connectedStudentsInRoom(code).filter((studentId) => Number(studentId) !== askerId);
      queries.addLiveOpportunity(db, shareTargets, {
        roomCode: code,
        activityId: activity.id,
        questionNumber: activity.questionNumber,
      });
      emitAudienceQnaState(code);
      emitLiveState(code);
      cb?.({ ok: true, activity: liveActivityForClients(activity) });
    } catch (error) {
      console.error(error);
      cb?.({ ok: false, error: 'Could not ask the room' });
    }
  });

  socket.on('teacher:qna-clear', (_payload, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false });
        return;
      }
      queries.clearAudienceQuestions(db, code);
      emitAudienceQnaState(code);
      cb?.({ ok: true });
    } catch (error) {
      console.error(error);
      cb?.({ ok: false, error: 'Could not clear Q&A' });
    }
  });

  socket.on('teacher:live-launch', (raw, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const allowedTypes = new Set(['choice', 'truefalse', 'rating', 'short', 'set']);
      const type = allowedTypes.has(raw?.type) ? raw.type : 'choice';
      const prompt = String(raw?.prompt || '').trim().slice(0, 500);
      if (!prompt) {
        cb?.({ ok: false, error: type === 'set' ? 'Name this set first' : 'Add a question first' });
        return;
      }

      let questions = [];
      if (type === 'set') {
        const allowedQuestionTypes = new Set(['choice', 'truefalse', 'rating', 'short']);
        const rawQuestions = Array.isArray(raw?.questions) ? raw.questions : [];
        questions = rawQuestions
          .map((item, index) => {
            const questionType = allowedQuestionTypes.has(item?.type) ? item.type : 'short';
            const questionPrompt = String(item?.prompt || '').trim().slice(0, 500);
            if (!questionPrompt) return null;
            let questionOptions = Array.isArray(item?.options)
              ? item.options.map((value) => String(value || '').trim().slice(0, 120)).filter(Boolean).slice(0, 6)
              : [];
            if (questionType === 'truefalse') questionOptions = ['True', 'False'];
            if (questionType === 'rating') questionOptions = ['1', '2', '3', '4', '5'];
            if (questionType === 'choice' && questionOptions.length < 2) return null;
            const requested = String(item?.correctAnswer || '').trim().slice(0, questionType === 'short' ? 500 : 120);
            let correctAnswer = '';
            if (questionType === 'short') correctAnswer = requested;
            else if (questionType !== 'rating' && questionOptions.includes(requested)) correctAnswer = requested;
            return {
              id: String(item?.id || `sq-${index + 1}`).slice(0, 80),
              type: questionType,
              prompt: questionPrompt,
              options: questionType === 'short' ? [] : questionOptions,
              correctAnswer,
            };
          })
          .filter(Boolean)
          .slice(0, 12);
        if (questions.length < 2) {
          cb?.({ ok: false, error: 'A set needs at least two questions' });
          return;
        }
      }

      let options = Array.isArray(raw?.options)
        ? raw.options.map((value) => String(value || '').trim().slice(0, 120)).filter(Boolean).slice(0, 6)
        : [];
      if (type === 'truefalse') options = ['True', 'False'];
      if (type === 'rating') options = ['1', '2', '3', '4', '5'];
      if (type === 'set') options = [];
      if (type === 'choice' && options.length < 2) {
        cb?.({ ok: false, error: 'Add at least two answer choices' });
        return;
      }
      const requestedCorrectAnswer = String(raw?.correctAnswer || '').trim().slice(0, 120);
      let correctAnswer = '';
      if (type === 'short') {
        correctAnswer = requestedCorrectAnswer;
      } else if (type !== 'rating' && type !== 'set' && options.includes(requestedCorrectAnswer)) {
        correctAnswer = requestedCorrectAnswer;
      }
      const imageUrl = String(raw?.imageUrl || '');
      if (imageUrl && (!imageUrl.startsWith('data:image/jpeg;base64,') || imageUrl.length > 1.5e6)) {
        cb?.({ ok: false, error: 'That image is too large' });
        return;
      }
      const timerSeconds = [15, 30, 60, 120].includes(Number(raw?.timerSeconds))
        ? Number(raw.timerSeconds)
        : 0;
      const activity = queries.launchLiveActivity(db, code, {
        id: randomUUID(),
        type,
        prompt,
        options,
        questions,
        correctAnswer,
        anonymous: !!raw?.anonymous,
        optional: !!raw?.optional,
        imageUrl,
        timerSeconds,
      });
      if (!activity.optional) {
        queries.addLiveOpportunity(db, connectedStudentsInRoom(code), {
          roomCode: code,
          activityId: activity.id,
          questionNumber: activity.questionNumber,
        });
      }
      emitLiveState(code);
      if (activity.timerSeconds > 0) {
        const endMs = activity.endsAt
          ? Date.parse(activity.endsAt)
          : Date.parse(activity.launchedAt) + activity.timerSeconds * 1000;
        const delayMs = Number.isFinite(endMs) ? Math.max(0, endMs - Date.now()) : activity.timerSeconds * 1000;
        setTimeout(() => {
          const current = queries.getLiveActivity(db, code);
          if (!current || current.id !== activity.id || current.locked) return;
          queries.updateLiveActivity(db, code, { locked: true });
          emitLiveState(code);
        }, delayMs);
      }
      cb?.({ ok: true, activity: liveActivityForClients(activity) });
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
      if (!activityForStudent(activity, sid)) {
        cb?.({ ok: false, error: 'This is your question — no need to answer it' });
        return;
      }
      if (
        activity.timerSeconds > 0 &&
        Date.now() >=
          (activity.endsAt
            ? Date.parse(activity.endsAt)
            : Date.parse(activity.launchedAt) + activity.timerSeconds * 1000)
      ) {
        queries.updateLiveActivity(db, code, { locked: true });
        emitLiveState(code);
        cb?.({ ok: false, error: 'Time is up' });
        return;
      }
      if (activity.type === 'set') {
        const questions = Array.isArray(activity.questions) ? activity.questions : [];
        if (questions.length < 2) {
          cb?.({ ok: false, error: 'That set is incomplete' });
          return;
        }
        let rawAnswers = value;
        if (typeof rawAnswers === 'string') {
          try {
            rawAnswers = JSON.parse(rawAnswers);
          } catch {
            rawAnswers = null;
          }
        }
        if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
          cb?.({ ok: false, error: 'Answer each question in the set' });
          return;
        }
        const answers = {};
        for (const question of questions) {
          const questionId = String(question.id || '');
          const questionType = question.type || 'short';
          const options = Array.isArray(question.options) ? question.options.map(String) : [];
          let answer = String(rawAnswers[questionId] ?? '').trim();
          answer = answer.slice(0, questionType === 'short' ? 500 : 120);
          if (!answer) {
            cb?.({ ok: false, error: 'Answer each question in the set' });
            return;
          }
          if (questionType !== 'short' && !options.includes(answer)) {
            cb?.({ ok: false, error: 'Choose one of the available answers' });
            return;
          }
          answers[questionId] = answer;
        }
        const encoded = JSON.stringify(answers).slice(0, 8000);
        queries.upsertLiveResponse(db, { activityId: activity.id, roomCode: code, studentId: sid, value: encoded });
        if (!activity.optional) queries.markLiveResponse(db, sid);
        emitLiveState(code);
        cb?.({ ok: true });
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

  socket.on('student:live-confidence', ({ activityId, confidence }, cb) => {
    try {
      const code = socket.data.roomCode;
      const sid = Number(socket.data.studentId);
      const activity = queries.getLiveActivity(db, code);
      if (socket.data.role !== 'student' || !sid || !activity || activity.id !== String(activityId || '')) {
        cb?.({ ok: false }); return;
      }
      queries.setLiveResponseConfidence(db, activity.id, sid, confidence);
      emitLiveState(code);
      cb?.({ ok: true });
    } catch { cb?.({ ok: false }); }
  });

  socket.on('teacher:live-acknowledge', ({ studentId }, cb) => {
    const code = socket.data.roomCode;
    const sid = Number(studentId);
    const row = sid ? queries.getStudent(db, sid) : null;
    if (socket.data.role !== 'teacher' || !code || !row || normalizeRoomCode(row.room_code) !== normalizeRoomCode(code)) {
      cb?.({ ok: false }); return;
    }
    queries.setStudentEngagementStatus(db, sid, '');
    io.to(studentSocketName(sid)).emit('live:help-seen', {});
    io.to(teacherSocketName(code)).emit('live:teacher', buildTeacherLivePayload(code));
    cb?.({ ok: true });
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
      const response = queries.listLiveResponses(db, code).find((item) => item.studentId === Number(studentId));
      if (published && response) {
        queries.addFeaturedWallItem(db, code, activity, response);
        io.to(studentSocketName(Number(studentId))).emit('live:featured', { questionNumber: activity.questionNumber });
      } else if (!published) queries.removeFeaturedWallItem(db, activity.id, Number(studentId));
      emitLiveState(code);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:featured-label', ({ id, label }, cb) => {
    const code = socket.data.roomCode;
    if (socket.data.role !== 'teacher' || !code) { cb?.({ ok: false }); return; }
    queries.setFeaturedWallLabel(db, code, Number(id), label);
    emitLiveState(code); cb?.({ ok: true });
  });

  socket.on('teacher:featured-remove', ({ id }, cb) => {
    const code = socket.data.roomCode;
    if (socket.data.role !== 'teacher' || !code) { cb?.({ ok: false }); return; }
    const item = queries.listFeaturedWall(db, code).find((entry) => entry.id === Number(id));
    if (item) queries.removeFeaturedWallItem(db, item.activityId, item.studentId);
    emitLiveState(code); cb?.({ ok: true });
  });

  socket.on('teacher:featured-clear', (_payload, cb) => {
    const code = socket.data.roomCode;
    if (socket.data.role !== 'teacher' || !code) { cb?.({ ok: false }); return; }
    queries.clearFeaturedWall(db, code);
    emitLiveState(code);
    cb?.({ ok: true });
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
      const excludedId = sourceStudentIdForActivity(activity);
      const targets = connectedStudentsInRoom(code).filter(
        (studentId) => !answered.has(studentId) && Number(studentId) !== excludedId
      );
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
      if (existing.teacher_markup_filename) unlinkRoomMedia(code, existing.teacher_markup_filename);
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
      if (existing.teacher_markup_filename) unlinkRoomMedia(code, existing.teacher_markup_filename);
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

  socket.on('teacher:drawing-markup', ({ studentId, imageBase64, mimeType, baseImageUrl }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const sid = Number(studentId);
      const existing = sid ? queries.getStudent(db, sid) : null;
      if (!existing || normalizeRoomCode(existing.room_code) !== code || !existing.image_filename) {
        cb?.({ ok: false, error: 'That drawing is no longer available' });
        return;
      }
      let requestedBase = '';
      try {
        requestedBase = safeMediaFilename(decodeURIComponent(String(baseImageUrl || '').split('/').pop().split('?')[0]));
      } catch {
        requestedBase = '';
      }
      if (!requestedBase || requestedBase !== safeMediaFilename(existing.image_filename)) {
        cb?.({ ok: false, error: 'The student changed their drawing — reopen it before marking up' });
        return;
      }
      if (String(mimeType || '').toLowerCase() !== 'image/png') {
        cb?.({ ok: false, error: 'Teacher markup must be a PNG overlay' });
        return;
      }
      const decoded = decodeImageBase64(imageBase64, 'image/png');
      if (decoded.error) {
        cb?.({ ok: false, error: decoded.error });
        return;
      }
      const filename = `tm${sid}-${Date.now()}.png`;
      fs.writeFileSync(path.join(boardMediaDir(code), filename), decoded.buf);
      const updated = queries.updateStudentDrawingMarkup(db, sid, filename, existing.image_filename);
      if (existing.teacher_markup_filename) unlinkRoomMedia(code, existing.teacher_markup_filename);
      const student = queries.rowToStudent(updated);
      io.to(roomSocketName(code)).emit('student:live', { student });
      cb?.({ ok: true, student });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not send the drawing correction' });
    }
  });

  socket.on('teacher:drawing-markup-clear', ({ studentId, baseImageUrl }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const sid = Number(studentId);
      const existing = sid ? queries.getStudent(db, sid) : null;
      if (!existing || normalizeRoomCode(existing.room_code) !== code || !existing.image_filename) {
        cb?.({ ok: false, error: 'That drawing is no longer available' });
        return;
      }
      let requestedBase = '';
      try {
        requestedBase = safeMediaFilename(decodeURIComponent(String(baseImageUrl || '').split('/').pop().split('?')[0]));
      } catch {
        requestedBase = '';
      }
      if (!requestedBase || requestedBase !== safeMediaFilename(existing.image_filename)) {
        cb?.({ ok: false, error: 'The student changed their drawing — reopen it before marking up' });
        return;
      }
      const updated = queries.clearStudentDrawingMarkup(db, sid);
      if (existing.teacher_markup_filename) unlinkRoomMedia(code, existing.teacher_markup_filename);
      const student = queries.rowToStudent(updated);
      io.to(roomSocketName(code)).emit('student:live', { student });
      cb?.({ ok: true, student });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not clear the drawing correction' });
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
      if (row.teacher_markup_filename) unlinkRoomMedia(code, row.teacher_markup_filename);
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

  socket.on('teacher:material-send', ({ title, fileBase64, mimeType, originalName, sendToInbox, placeOnBoard }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const toInbox = sendToInbox !== false;
      const onBoard = placeOnBoard === true;
      if (!toInbox && !onBoard) {
        cb?.({ ok: false, error: 'Choose Send to Inbox and/or Place on this board' });
        return;
      }
      const decoded = decodeMaterialBase64(fileBase64, mimeType, originalName);
      if (decoded.error) {
        cb?.({ ok: false, error: decoded.error });
        return;
      }
      const cleanOriginal = String(originalName || `handout.${decoded.ext}`)
        .replace(/[^\w.\- ()[\]]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || `handout.${decoded.ext}`;
      const filename = `mat-${Date.now()}-${randomUUID().slice(0, 8)}.${decoded.ext}`;
      fs.writeFileSync(path.join(boardMediaDir(code), filename), decoded.buf);
      const handoutTitle = String(title || '').trim().slice(0, 80) || cleanOriginal;
      let item = null;
      if (toInbox) {
        item = {
          id: `material-${Date.now()}-${randomUUID().slice(0, 6)}`,
          type: 'material',
          title: handoutTitle,
          originalName: cleanOriginal,
          filename,
          mimeType: decoded.mime,
          size: decoded.buf.length,
          url: `/api/board-media/${encodeURIComponent(code)}/${encodeURIComponent(filename)}`,
          at: Date.now(),
        };
        emitMaterialToRoom(code, item);
      }
      let post = null;
      if (onBoard) {
        const isImage = decoded.mime.startsWith('image/');
        post = queries.addBoardPost(db, code, {
          kind: isImage ? 'image' : 'file',
          title: handoutTitle,
          text: cleanOriginal,
          image_filename: filename,
          size: isImage ? 2 : 3,
        });
        broadcastRoom(code);
      }
      cb?.({
        ok: true,
        item,
        post: post ? queries.rowToBoardPost(post) : null,
      });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not send that file' });
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

  socket.on('teacher:evidence-combine', ({ profileKeys, canonicalKey }, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const requested = [...new Set(
        (Array.isArray(profileKeys) ? profileKeys : [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )].slice(0, 50);
      const profiles = buildEvidenceStudentProfiles(code);
      const byKey = new Map(profiles.map((profile) => [profile.key, profile]));
      const selected = requested.filter((key) => byKey.has(key));
      const canonical = byKey.get(String(canonicalKey || ''));
      if (selected.length < 2 || !canonical || !selected.includes(canonical.key)) {
        cb?.({ ok: false, error: 'Select at least two names and choose the name to keep' });
        return;
      }
      queries.combineReportAliases(db, code, selected, canonical.key, canonical.name);
      cb?.({
        ok: true,
        students: buildEvidenceStudentProfiles(code),
        selectedKey: canonical.key,
      });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not combine those names' });
    }
  });

  socket.on('teacher:evidence-uncombine', ({ profileKey }, cb) => {
    try {
      const code = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !code) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const key = String(profileKey || '').trim();
      const profile = buildEvidenceStudentProfiles(code).find((item) => item.key === key);
      if (!profile?.combined) {
        cb?.({ ok: false, error: 'That report does not contain combined names' });
        return;
      }
      queries.clearReportAliasGroup(db, code, key);
      cb?.({ ok: true, students: buildEvidenceStudentProfiles(code) });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Could not separate those names' });
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
      queries.clearAudienceQuestions(db, code);
      const studentRows = queries.deleteAllStudents(db, code);
      for (const s of studentRows) {
        if (s.image_filename) unlinkRoomMedia(code, s.image_filename);
        if (s.teacher_markup_filename) unlinkRoomMedia(code, s.teacher_markup_filename);
      }
      const postRows = queries.deleteAllBoardPosts(db, code);
      for (const p of postRows) {
        if (p.image_filename) unlinkRoomMedia(code, p.image_filename);
      }
      broadcastHistoryByRoom.delete(code);
      io.to(roomSocketName(code)).emit('broadcast:exemplars', {
        items: [],
        history: [],
        at: Date.now(),
      });
      const materials = materialHistoryForRoom(code);
      for (const item of materials) {
        if (item?.filename) unlinkRoomMedia(code, item.filename);
      }
      materialHistoryByRoom.delete(code);
      io.to(roomSocketName(code)).emit('inbox:material', { history: [], cleared: true });
      queries.clearLiveActivity(db, code);
      queries.clearFeaturedWall(db, code);
      queries.clearLessonPulseLog(db, code);
      queries.resetLiveQuestionNumber(db, code);
      broadcastRoom(code);
      emitLiveState(code);
      emitAudienceQnaState(code);
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
