import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { openDatabase, queries } from './db.js';
import { truncateToWordLimit } from './text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const dataDir = path.join(__dirname, 'data');
const clientDist = path.join(__dirname, '..', 'client', 'dist');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const db = openDatabase();

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

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

function buildRoomPayload(code) {
  const row = queries.ensureRoom(db, code);
  const students = queries.listStudents(db, code);
  return {
    room: queries.rowToRoom(row),
    students: students.map(queries.rowToStudent),
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
      socket.data.role = 'teacher';
      socket.data.roomCode = c;
      broadcastRoom(c);
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
      socket.data.role = 'student';
      socket.data.roomCode = c;
      socket.data.studentId = student.id;
      const payload = buildRoomPayload(c);
      cb?.({ ok: true, student, room: payload.room, students: payload.students });
      emitRoomState(c, payload);
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
      if (!row || row.room_code !== c) {
        cb?.({ ok: false, error: 'Session expired — join again' });
        return;
      }
      const student = queries.rowToStudent(row);
      socket.join(roomSocketName(c));
      socket.data.role = 'student';
      socket.data.roomCode = c;
      socket.data.studentId = student.id;
      const payload = buildRoomPayload(c);
      cb?.({ ok: true, student, room: payload.room, students: payload.students });
      emitRoomState(c, payload);
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'Server error' });
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
      const row = queries.updateStudentText(db, sid, t);
      const student = queries.rowToStudent(row);
      io.to(roomSocketName(code)).emit('student:live', { student });
      broadcastRoom(code);
      cb?.({ ok: true });
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

  socket.on('teacher:broadcast', async ({ studentIds }, cb) => {
    try {
      const codeRaw = socket.data.roomCode;
      if (socket.data.role !== 'teacher' || !codeRaw) {
        cb?.({ ok: false, error: 'Open the room again as teacher (socket not in room)' });
        return;
      }
      const code = normalizeRoomCode(codeRaw);
      const raw = Array.isArray(studentIds) ? studentIds : [];
      const ids = [];
      const seen = new Set();
      for (const x of raw) {
        const n = Number(x);
        if (n > 0 && !seen.has(n)) {
          seen.add(n);
          ids.push(n);
        }
        if (ids.length >= 6) break;
      }
      if (!ids.length) {
        cb?.({ ok: false, error: 'Select at least one student draft' });
        return;
      }
      const items = [];
      for (const id of ids) {
        const row = queries.getStudent(db, id);
        if (!row || normalizeRoomCode(row.room_code) !== code) continue;
        const label = `Exemplar ${String.fromCharCode(65 + items.length)}`;
        items.push({ label, text: String(row.text || '').slice(0, 14_000) });
      }
      if (!items.length) {
        cb?.({
          ok: false,
          error: 'No matching students in this room (refresh the page or re-open the room)',
        });
        return;
      }
      const payload = { items, at: Date.now() };
      const room = roomSocketName(code);
      const sockets = await io.in(room).fetchSockets();
      for (const s of sockets) {
        s.emit('broadcast:exemplars', payload);
      }
      cb?.({ ok: true, count: items.length, reached: sockets.length });
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
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`Quik Coach server on http://localhost:${PORT}`);
});
