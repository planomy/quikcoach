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

function StartShell({ step, labelledBy, onKeyDown, children, corner }) {
  return (
    <div
      className="iboard-start-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      <div className="iboard-start-screen__top">
        {step ? (
          <ol className="iboard-start-screen__steps" aria-label="Lesson start steps">
            <li className={step === 'join' ? 'is-current' : 'is-done'}>Students join</li>
            <li className={step === 'objective' ? 'is-current' : ''}>Today’s objective</li>
            <li>Room</li>
          </ol>
        ) : <span />}
        {corner}
      </div>
      <div className="iboard-start-screen__body">{children}</div>
    </div>
  );
}

/**
 * Join screen: big room code, address, QR and names as they arrive.
 * `mode="start"` is step one of a new lesson; `mode="room"` reopens it mid-lesson.
 */
export function JoinScreen({ mode = 'start', code, joinUrl, students = [], onNext, onSkip, onClose, onCopyLink }) {
  const primaryRef = useRef(null);
  const qrSvg = useMemo(() => {
    try {
      return renderSVG(joinUrl, { border: 1 });
    } catch {
      return '';
    }
  }, [joinUrl]);
  const address = joinUrl.replace(/^https?:\/\//, '').replace(/\?code=\d+$/, '');
  const names = students.map((student) => String(student.name || '').trim()).filter(Boolean);

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (mode === 'start') onSkip?.();
      else onClose?.();
    }
  }

  return (
    <StartShell
      step={mode === 'start' ? 'join' : null}
      labelledBy="join-screen-title"
      onKeyDown={handleKeyDown}
      corner={mode === 'start' ? (
        <button type="button" onClick={onSkip} className="iboard-start-screen__skip">Skip to room</button>
      ) : null}
    >
      <div className="iboard-join-screen">
        <div className="iboard-join-screen__main">
          <h2 id="join-screen-title" className="iboard-join-screen__title">Students join here</h2>
          <ol className="iboard-join-screen__how">
            <li>Go to <strong>{address}</strong></li>
            <li>Enter the room code</li>
          </ol>
          <p className="iboard-join-screen__code" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</p>
          <button type="button" onClick={onCopyLink} className="iboard-join-screen__copy">Copy join link</button>
        </div>
        {qrSvg ? (
          <div className="iboard-join-screen__qr">
            <div className="iboard-join-screen__qr-code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p>Or scan to join</p>
          </div>
        ) : null}
      </div>

      <section className="iboard-join-screen__arrivals" aria-live="polite" aria-label="Students joined">
        <p className="iboard-join-screen__count">
          {names.length === 0
            ? 'Waiting for students…'
            : `${names.length} student${names.length === 1 ? '' : 's'} joined`}
        </p>
        {names.length ? (
          <ul className="iboard-join-screen__names">
            {names.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
          </ul>
        ) : null}
      </section>

      <div className="iboard-start-screen__actions">
        {mode === 'start' ? (
          <button ref={primaryRef} type="button" onClick={onNext} className="iboard-start-screen__primary">
            Next: today’s objective
            <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button ref={primaryRef} type="button" onClick={onClose} className="iboard-start-screen__primary">
            Back to room
          </button>
        )}
      </div>
    </StartShell>
  );
}

/**
 * Today's objective: one line, recent objectives one tap away.
 * `mode="start"` is step two of a new lesson; `mode="edit"` changes it mid-lesson.
 */
export function ObjectiveScreen({ mode = 'start', initialObjective = '', busy = false, onSave, onSkip, onBack, onClose }) {
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
      if (mode === 'start') onSkip?.();
      else onClose?.();
    }
  }

  return (
    <StartShell
      step={mode === 'start' ? 'objective' : null}
      labelledBy="objective-screen-title"
      onKeyDown={handleKeyDown}
      corner={mode === 'start' ? (
        <button type="button" onClick={onSkip} className="iboard-start-screen__skip">Skip to room</button>
      ) : null}
    >
      <form className="iboard-objective-screen" onSubmit={submit}>
        <h2 id="objective-screen-title" className="iboard-join-screen__title">Today’s objective</h2>
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
        <p className="iboard-objective-screen__hint">
          {mode === 'start'
            ? 'Students see this at the top of their screen. You can leave it blank and add it later.'
            : 'Students see this at the top of their screen.'}
        </p>
        <div className="iboard-start-screen__actions">
          {mode === 'start' ? (
            <button type="button" onClick={onBack} className="iboard-start-screen__secondary">Back</button>
          ) : (
            <button type="button" onClick={onClose} className="iboard-start-screen__secondary">Cancel</button>
          )}
          {mode === 'edit' && initialObjective ? (
            <button type="button" disabled={busy} onClick={() => onSave?.('')} className="iboard-start-screen__secondary">
              Clear objective
            </button>
          ) : null}
          <button type="submit" disabled={busy} className="iboard-start-screen__primary">
            {mode === 'start' ? 'Start lesson' : 'Save'}
            {mode === 'start' ? <span aria-hidden="true">→</span> : null}
          </button>
        </div>
      </form>
    </StartShell>
  );
}
