import { useEffect, useMemo, useRef, useState } from 'react';
import { renderSVG } from 'uqr';
import HintWrap from './HintWrap.jsx';

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

function useJoinInfo(joinUrl) {
  const qrSvg = useMemo(() => {
    try {
      return renderSVG(joinUrl, { border: 1 });
    } catch {
      return '';
    }
  }, [joinUrl]);
  const address = joinUrl.replace(/^https?:\/\//, '').replace(/\?code=\d+$/, '');
  return { qrSvg, address };
}

function joinedLabel(joinedCount, rosterCount) {
  if (joinedCount === 0) return 'Waiting for students…';
  if (rosterCount > joinedCount) return `${joinedCount} of ${rosterCount} students in`;
  return `${joinedCount} student${joinedCount === 1 ? '' : 's'} joined`;
}

/** Full-screen join view for projecting, opened from the header room code. */
export function JoinScreen({ code, joinUrl, joinedCount = 0, rosterCount = 0, onClose }) {
  const { qrSvg, address } = useJoinInfo(joinUrl);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="iboard-start-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-screen-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose?.();
      }}
    >
      <div className="iboard-join-screen">
        <h2 id="join-screen-title" className="iboard-join-screen__address">
          Students enter code at: <strong>{address}</strong>
        </h2>

        <div className="iboard-join-screen__code-row">
          <p className="iboard-join-screen__code" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</p>
          {qrSvg ? (
            <div className="iboard-join-screen__qr-code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : null}
        </div>

        <p className="iboard-join-screen__count" aria-live="polite">{joinedLabel(joinedCount, rosterCount)}</p>

        <button ref={closeRef} type="button" onClick={onClose} className="iboard-start-screen__primary">
          Back to the board
        </button>
      </div>
    </div>
  );
}

/**
 * Join info on the board itself: big while nobody is connected, a slim bar once
 * students are arriving. Projected with the board, so no separate start screen.
 */
export function BoardJoinPanel({ code, joinUrl, joinedCount = 0, rosterCount = 0, onShowBig, onDismiss }) {
  const { qrSvg, address } = useJoinInfo(joinUrl);

  if (joinedCount === 0) {
    return (
      <section className="iboard-board-join" aria-label="How students join">
        <div className="iboard-board-join__text">
          <p className="iboard-board-join__address">
            Students enter code at: <strong>{address}</strong>
          </p>
          <p className="iboard-board-join__code" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</p>
          <p className="iboard-board-join__count" aria-live="polite">{joinedLabel(joinedCount, rosterCount)}</p>
        </div>
        {qrSvg ? (
          <div className="iboard-board-join__qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        ) : null}
      </section>
    );
  }

  return (
    <div className="iboard-board-join-bar" role="status" aria-live="polite">
      <span>
        Students join at <strong>{address}</strong> · code <strong className="iboard-board-join-bar__code">{code}</strong>
      </span>
      <span className="iboard-board-join-bar__count">{joinedLabel(joinedCount, rosterCount)}</span>
      <span className="iboard-board-join-bar__actions">
        <HintWrap hint="Show the join details full screen for the projector" prefer="below">
          <button type="button" onClick={onShowBig}>Show big</button>
        </HintWrap>
        <HintWrap hint="Hide this bar (click the room code at the top to see it again)" prefer="below">
          <button type="button" onClick={onDismiss} aria-label="Hide the join bar">×</button>
        </HintWrap>
      </span>
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
