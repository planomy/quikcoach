const PIN_KEY = 'iboard-teacher-unlocked';
export const TEACHER_PIN = '1011';

export function isTeacherUnlocked() {
  try {
    return sessionStorage.getItem(PIN_KEY) === '1';
  } catch {
    return false;
  }
}

export function unlockTeacher(pin) {
  if (String(pin || '').trim() !== TEACHER_PIN) return false;
  try {
    sessionStorage.setItem(PIN_KEY, '1');
  } catch {
    /* ignore */
  }
  return true;
}
