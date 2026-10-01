/** Fullscreen across browsers; iPad browsers other than Safari can't do it at all. */
export const FULLSCREEN_UNAVAILABLE_MESSAGE = 'This browser can’t go fullscreen. On an iPad, open TUIT in Safari.';

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export function canFullscreen() {
  const root = document.documentElement;
  if (!root.requestFullscreen && !root.webkitRequestFullscreen) return false;
  return document.fullscreenEnabled !== false || document.webkitFullscreenEnabled === true;
}

export async function toggleFullscreen() {
  if (isFullscreen()) {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    return;
  }
  if (!canFullscreen()) throw new Error(FULLSCREEN_UNAVAILABLE_MESSAGE);
  const root = document.documentElement;
  if (root.requestFullscreen) await root.requestFullscreen();
  else await root.webkitRequestFullscreen();
}

export function subscribeFullscreenChange(callback) {
  document.addEventListener('fullscreenchange', callback);
  document.addEventListener('webkitfullscreenchange', callback);
  return () => {
    document.removeEventListener('fullscreenchange', callback);
    document.removeEventListener('webkitfullscreenchange', callback);
  };
}
