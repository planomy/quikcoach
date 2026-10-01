export const VERBAL_PROMPT = 'Verbal question';
export const VERBAL_QUIET_MS = 15_000;

export function isVerbalActivity(activity) {
  return activity?.type === 'short' && activity?.prompt === VERBAL_PROMPT;
}

export function liveActivityExpired(activity, now = Date.now()) {
  if (!activity || !(Number(activity.timerSeconds) > 0)) return false;
  const endMs = activity.endsAt
    ? Date.parse(activity.endsAt)
    : Date.parse(activity.launchedAt) + Number(activity.timerSeconds) * 1000;
  return Number.isFinite(endMs) && now >= endMs;
}

/** SQLite datetime('now') is UTC without a zone ('YYYY-MM-DD HH:MM:SS'). */
export function parseDbTime(value) {
  const text = String(value || '').trim();
  if (!text) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

/**
 * True when a student who already answered this verbal round re-taps + Answer
 * after the board has had no new answers for VERBAL_QUIET_MS — i.e. the teacher
 * has moved on to the next spoken question. Inside the window it's a changed answer.
 */
export function verbalRoundIsStale({ activity, responses = [], studentId, now = Date.now() }) {
  if (!isVerbalActivity(activity)) return false;
  const round = responses.filter((response) => response.activityId === activity.id);
  if (!round.some((response) => Number(response.studentId) === Number(studentId))) return false;
  const lastAt = Math.max(...round.map((response) => parseDbTime(response.submittedAt)));
  return Number.isFinite(lastAt) && now - lastAt >= VERBAL_QUIET_MS;
}

/**
 * What a student's + Answer does given the room's single live question.
 * A new verbal round replaces the live question (and its live responses), so it
 * only happens when nothing is open or the verbal round has gone quiet; lesson
 * report cells are kept either way.
 *   launch → start a new 'Verbal question' round
 *   answer → upsert this student's answer on the live question
 *   refuse → leave the live question alone and return `error`
 */
export function decideVerbalResponseAction({ activity, now = Date.now(), eligible = true, isAsker = false, responses = [], studentId = null }) {
  if (!activity) return { action: 'launch' };
  if (activity.locked || liveActivityExpired(activity, now)) return { action: 'launch' };
  if (!eligible) {
    return {
      action: 'refuse',
      error: isAsker
        ? 'This is your question — no need to answer it'
        : 'Your teacher has a question open for other students right now',
    };
  }
  if (activity.type !== 'short') {
    return { action: 'refuse', error: 'Answer the question on your screen first' };
  }
  if (verbalRoundIsStale({ activity, responses, studentId, now })) return { action: 'launch' };
  return { action: 'answer' };
}
