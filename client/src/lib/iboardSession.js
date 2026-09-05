import { downloadTextFile, stampForFilename, safeFilePart } from './exportRoom.js';

export const IBOARD_SESSION_MIME = 'application/json';
export const IBOARD_SESSION_EXT = 'iboard';

export function sessionFilename(roomCode, label = '') {
  const code = String(roomCode || 'room').replace(/\D/g, '').slice(0, 4).padStart(4, '0') || '0000';
  const part = safeFilePart(label);
  const stamp = stampForFilename();
  if (part && part !== 'student') {
    return `iBoard-${code}-${part}-${stamp}.${IBOARD_SESSION_EXT}`;
  }
  return `iBoard-${code}-${stamp}.${IBOARD_SESSION_EXT}`;
}

export async function downloadSessionPack(pack, roomCode, label = '') {
  const name = sessionFilename(roomCode, label);
  const body = JSON.stringify(pack, null, 2);
  return downloadTextFile(name, body, IBOARD_SESSION_MIME);
}

export function parseSessionFileText(text) {
  let pack;
  try {
    pack = JSON.parse(String(text || ''));
  } catch {
    throw new Error('That file is not valid JSON');
  }
  if (!pack || pack.format !== 'iboard') {
    throw new Error('Not an iBoard session file (.iboard)');
  }
  if (Number(pack.version) !== 1) {
    throw new Error('Unsupported session file version');
  }
  if (!Array.isArray(pack.students)) {
    throw new Error('Session file is missing classroom data');
  }
  return pack;
}

export function readSessionFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseSessionFileText(String(reader.result || '')));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsText(file);
  });
}

export function emitAck(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Not connected'));
      return;
    }
    socket.timeout(120_000).emit(event, payload, (err, ack) => {
      if (err) {
        reject(new Error('Timed out — try a smaller session or check your connection'));
        return;
      }
      resolve(ack);
    });
  });
}
