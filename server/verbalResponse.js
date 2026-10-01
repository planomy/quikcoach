export const VERBAL_PROMPT = 'Verbal question';

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

/**
 * What a student's + Answer does given the room's single live question.
 * A new verbal round replaces the live question (and its live responses), so it
 * only happens when nothing is open; lesson report cells are kept either way.
 *   launch → start a new 'Verbal question' round
 *   answer → upsert this student's answer on the live question
 *   refuse → leave the live question alone and return `error`
 */
export function decideVerbalResponseAction({ activity, now = Date.now(), eligible = true, isAsker = false }) {
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
  return { action: 'answer' };
}
