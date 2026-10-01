import { useEffect, useMemo, useRef, useState } from 'react';
import { renderSVG } from 'uqr';

const RECENT_OBJECTIVES_KEY = 'tuit-recent-objectives';
const OBJECTIVE_MAX = 200;

export function readRecentObjectives() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_OBJECTIVES_KEY) || '[]');
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberObjective(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  try {
    const next = [clean, ...readRecentObjectives().filter((item) => item !== clean)].slice(0, 5);
    localStorage.setItem(RECENT_OBJECTIVES_KEY, JSON.stringify(next));
  } catch {
    /* storage may be unavailable */
  }
}

function StartShell({ labelledBy, onKeyDown, children }) {
  return (
    <div
      className="iboard-start-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      <div className="iboard-start-screen__body">{children}</div>
    </div>
  );
}

/**
 * Join screen: address, room code + QR, a live joined count, and an optional objective.
 * ENTER (or Escape) goes into the room. Also reopened mid-lesson from the header room code.
 */
export function JoinScreen({ code, joinUrl, students = [], initialObjective = '', onEnter }) {
  const [objective, setObjective] = useState(initialObjective);
  const qrSvg = useMemo(() => {
    try {
      return renderSVG(joinUrl, { border: 1 });
    } catch {
      return '';
    }
  }, [joinUrl]);
  const address = joinUrl.replace(/^https?:\/\//, '').replace(/\?code=\d+$/, '');
  const joinedCount = students.length;

  function enter(event) {
    event?.preventDefault();
    onEnter?.(objective.replace(/\s+/g, ' ').trim().slice(0, OBJECTIVE_MAX));
  }

  return (
    <div
      className="iboard-start-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-screen-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') enter(event);
      }}
    >
      <div className="iboard-join-screen">
        <h2 id="join-screen-title" className="iboard-join-screen__address">
          Students join at: <strong>{address}</strong>
        </h2>

        <div className="iboard-join-screen__code-row">
          <p className="iboard-join-screen__code" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</p>
          {qrSvg ? (
            <div className="iboard-join-screen__qr-code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : null}
        </div>

        <p className="iboard-join-screen__count" aria-live="polite">
          {joinedCount === 0 ? 'Waiting for students…' : `${joinedCount} student${joinedCount === 1 ? '' : 's'} joined`}
        </p>

        <form className="iboard-join-screen__enter" onSubmit={enter}>
          <input
            type="text"
            autoFocus
            value={objective}
            maxLength={OBJECTIVE_MAX}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Today’s objective (optional)"
            aria-label="Today’s objective (optional)"
          />
          <button type="submit" className="iboard-start-screen__primary">ENTER</button>
        </form>
      </div>
    </div>
  );
}

/** Change today's objective mid-lesson; recent objectives one tap away. */
export function ObjectiveScreen({ initialObjective = '', busy = false, onSave, onClose }) {
  const [text, setText] = useState(initialObjective);
  const [recent] = useState(readRecentObjectives);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(event) {
    event?.preventDefault();
    if (busy) return;
    onSave?.(text.replace(/\s+/g, ' ').trim().slice(0, OBJECTIVE_MAX));
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  }

  return (
    <StartShell labelledBy="objective-screen-title" onKeyDown={handleKeyDown}>
      <form className="iboard-objective-screen" onSubmit={submit}>
        <h2 id="objective-screen-title" className="iboard-objective-screen__title">Today’s objective</h2>
        <label className="iboard-objective-screen__field">
          <span>Today we are learning to…</span>
          <textarea
            ref={inputRef}
            value={text}
            rows={2}
            maxLength={OBJECTIVE_MAX}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) submit(event);
            }}
            placeholder="e.g. write a strong opening sentence"
          />
        </label>
        {recent.length ? (
          <div className="iboard-objective-screen__recent">
            <p>Recent</p>
            <div>
              {recent.map((item) => (
                <button key={item} type="button" onClick={() => setText(item)}>{item}</button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="iboard-objective-screen__hint">Students see this at the top of their screen.</p>
        <div className="iboard-start-screen__actions">
          <button type="button" onClick={onClose} className="iboard-start-screen__secondary">Cancel</button>
          {initialObjective ? (
            <button type="button" disabled={busy} onClick={() => onSave?.('')} className="iboard-start-screen__secondary">
              Clear objective
            </button>
          ) : null}
          <button type="submit" disabled={busy} className="iboard-start-screen__primary">Save</button>
        </div>
      </form>
    </StartShell>
  );
}
