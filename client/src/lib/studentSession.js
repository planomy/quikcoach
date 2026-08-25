const SESSION_KEY = 'quik-coach-student';
const RECENT_SESSIONS_KEY = 'quik-coach-recent-students';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_RECENT_ROOMS = 12;

function cleanCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function normaliseSession(value) {
  if (!value || typeof value !== 'object') return null;
  const code = cleanCode(value.code);
  const studentId = Number(value.studentId);
  if (code.length !== 4 || !studentId) return null;
  return {
    code,
    studentId,
    name: String(value.name || '').trim().slice(0, 120),
    savedAt: Number(value.savedAt || 0),
  };
}

function isExpired(session) {
  return !!session?.savedAt && Date.now() - session.savedAt > SESSION_MAX_AGE_MS;
}

function readRecentMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SESSIONS_KEY) || '{}');
    const current = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const fresh = {};
    for (const [key, value] of Object.entries(current)) {
      const session = normaliseSession(value);
      if (!session || isExpired(session)) continue;
      fresh[key] = session;
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeRecentMap(map) {
  try {
    const limited = Object.fromEntries(
      Object.entries(map)
        .sort(([, a], [, b]) => Number(b?.savedAt || 0) - Number(a?.savedAt || 0))
        .slice(0, MAX_RECENT_ROOMS)
    );
    localStorage.setItem(RECENT_SESSIONS_KEY, JSON.stringify(limited));
  } catch {
    /* The active lesson can still work when persistent storage is blocked. */
  }
}

export function readSavedStudentSession() {
  try {
    const session = normaliseSession(
      JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null')
    );
    if (!session) return null;
    if (isExpired(session)) {
      clearStudentSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveStudentSession(value) {
  const incoming = normaliseSession({ ...value, savedAt: Date.now() });
  if (!incoming) return null;

  const recent = readRecentMap();
  const previous = recent[incoming.code];
  const session = {
    ...incoming,
    name: incoming.name || previous?.name || '',
    savedAt: Date.now(),
  };
  const serialised = JSON.stringify(session);
  try { sessionStorage.setItem(SESSION_KEY, serialised); } catch { /* ignore */ }
  try { localStorage.setItem(SESSION_KEY, serialised); } catch { /* ignore */ }

  recent[session.code] = session;
  writeRecentMap(recent);
  return session;
}

export function clearStudentSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export function recentStudentSessionForRoom(value) {
  const code = cleanCode(value);
  if (code.length !== 4) return null;
  return readRecentMap()[code] || null;
}

export function forgetRecentStudentSession(value) {
  const code = cleanCode(value);
  if (code.length !== 4) return;
  const recent = readRecentMap();
  delete recent[code];
  writeRecentMap(recent);
}
