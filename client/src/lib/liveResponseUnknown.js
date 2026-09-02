export const UNKNOWN_ANSWER = '__iboard_unknown__';

export function isUnknownAnswer(value) {
  return String(value || '') === UNKNOWN_ANSWER;
}

export function formatLiveAnswer(value) {
  return isUnknownAnswer(value) ? "I don't know" : String(value || '');
}
