import { useSyncExternalStore } from 'react';

const HINTS_OFF_KEY = 'iboard-hints-off';
const listeners = new Set();

function readHintsOff() {
  try {
    return localStorage.getItem(HINTS_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

let hintsOff = typeof window === 'undefined' ? false : readHintsOff();

export function setHintsOff(off) {
  hintsOff = !!off;
  try {
    localStorage.setItem(HINTS_OFF_KEY, hintsOff ? '1' : '0');
  } catch {
    /* storage may be unavailable */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHintsOff() {
  return useSyncExternalStore(subscribe, () => hintsOff, () => false);
}
