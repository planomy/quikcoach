import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderSVG } from 'uqr';
import { getOverlayRoot } from '../lib/overlayRoot.js';
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
  return createPortal(
    <div
      className="iboard-start-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      <div className="iboard-start-screen__body">{children}</div>
    </div>,
    getOverlayRoot()
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
export function JoinScreen({ code, joinUrl, joinedCount = 0, rosterCount = 0, primaryLabel = 'Back to the board', phase = 'still', onClose }) {
  const { qrSvg, address } = useJoinInfo(joinUrl);
  const closeRef = useRef(null);

  useEffect(() => {
    if (phase === 'settling') return;
    closeRef.current?.focus();
  }, [phase]);

  return createPortal(
    <div
      className={`iboard-start-screen${phase === 'settling' ? ' is-settling' : ''}${phase === 'arrived' ? ' is-arrived' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-screen-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose?.();
      }}
    >
      <div className="iboard-join-screen" aria-hidden={phase === 'settling' ? true : undefined}>
        <div className="iboard-join-screen__brand" role="img" aria-label="TUIT, Focused Teaching and Learning">
          <img src="/brand/tuit-mark.png?v=2" alt="" className="iboard-join-screen__mark" />
          <p className="iboard-join-screen__word" aria-hidden="true">TUIT</p>
          <p className="iboard-join-screen__tag" aria-hidden="true">Focused Teaching & Learning</p>
        </div>

        <div className="iboard-join-screen__details">
          <div className="iboard-join-screen__lines">
            <h2 id="join-screen-title" className="iboard-join-screen__lead">Students go to :</h2>
            <p className="iboard-join-screen__url">{address}</p>
            <p className="iboard-join-screen__code-line">
              Enter Code : <span aria-label={`Room code ${code.split('').join(' ')}`}>{code}</span>
            </p>
            {qrSvg ? (
              <div className="iboard-join-screen__qr-code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            ) : null}
          </div>
          <p className="iboard-join-screen__count" aria-live="polite">{joinedLabel(joinedCount, rosterCount)}</p>
          <button ref={closeRef} type="button" onClick={onClose} className="iboard-start-screen__primary">
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    getOverlayRoot()
  );
}

/**
 * Covers the board until the teacher presses Begin, so nobody sees a card (or a
 * silly name) while the class is joining — safe to project or not.
 */
export function BoardJoinGate({ code, joinUrl, students = [], rosterCount = 0, objective = '', onObjectiveChange, onBegin, onRemoveStudent }) {
  const { qrSvg, address } = useJoinInfo(joinUrl);
  const [objectiveDraft, setObjectiveDraft] = useState(objective);
  const [showNames, setShowNames] = useState(false);
  const joinedCount = students.length;

  useEffect(() => {
    setObjectiveDraft(objective);
  }, [objective]);

  function saveObjective() {
    const clean = objectiveDraft.replace(/\s+/g, ' ').trim().slice(0, OBJECTIVE_MAX);
    if (clean !== objective) onObjectiveChange?.(clean);
  }

  return (
    <div className="iboard-join-gate">
      <section className="iboard-join-gate__panel" aria-label="Students joining">
        <p className="iboard-join-gate__address">
          Students enter code at: <strong>{address}</strong>
        </p>
        <div className="iboard-join-gate__code-row">
          <p className="iboard-join-gate__code" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</p>
          {qrSvg ? (
            <div className="iboard-join-gate__qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : null}
        </div>
        <p className="iboard-join-gate__count" aria-live="polite">{joinedLabel(joinedCount, rosterCount)}</p>
        <input
          type="text"
          className="iboard-join-gate__objective"
          value={objectiveDraft}
          maxLength={OBJECTIVE_MAX}
          onChange={(event) => setObjectiveDraft(event.target.value)}
          onBlur={saveObjective}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              saveObjective();
              event.currentTarget.blur();
            }
          }}
          placeholder="Optional – write today’s objective here"
          aria-label="Today’s objective (optional)"
        />
        {showNames ? (
          joinedCount ? (
            <ul className="iboard-join-gate__names" aria-label="Students who have joined">
              {students.map((student) => (
                <li key={student.id}>
                  <span>{student.name || 'Student'}</span>
                  <HintWrap hint={`Remove ${student.name || 'this student'}`} prefer="above">
                    <button type="button" onClick={() => onRemoveStudent?.(student)} aria-label={`Remove ${student.name || 'student'}`}>×</button>
                  </HintWrap>
                </li>
              ))}
            </ul>
          ) : (
            <p className="iboard-join-gate__names-empty">No one has joined yet.</p>
          )
        ) : null}
        <div className="iboard-join-gate__actions">
          <HintWrap hint={showNames ? 'Hide the names again' : 'See who’s in, or remove a silly name. Turn the projector off first if it’s on.'} prefer="above" multiline>
            <button type="button" className="iboard-join-gate__names-toggle" onClick={() => setShowNames((open) => !open)} aria-pressed={showNames}>
              {showNames ? 'Hide names' : 'Show names'}
            </button>
          </HintWrap>
          <HintWrap hint="Show the student cards and start the lesson. Late students can still join with the code." prefer="above" multiline>
            <button type="button" className="iboard-join-gate__begin" onClick={onBegin}>
              Begin
            </button>
          </HintWrap>
        </div>
      </section>
    </div>
  );
}

/** Change today's objective mid-lesson. */
export function ObjectiveScreen({ initialObjective = '', busy = false, entrance = false, onSave, onClose }) {
  const [text, setText] = useState(initialObjective);
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
        <div className="iboard-join-screen__brand" role="img" aria-label="TUIT, Focused Teaching and Learning">
          <img src="/brand/tuit-mark.png?v=2" alt="" className="iboard-join-screen__mark" />
          <p className="iboard-join-screen__word" aria-hidden="true">TUIT</p>
          <p className="iboard-join-screen__tag" aria-hidden="true">Focused Teaching & Learning</p>
        </div>
        <div className="iboard-objective-screen__body">
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
          <p className="iboard-objective-screen__hint">Students see this at the top of their screen.</p>
        </label>
        <div className="iboard-start-screen__actions">
          <button type="button" onClick={onClose} className="iboard-start-screen__secondary">{entrance ? 'Back' : 'Cancel'}</button>
          {initialObjective && !entrance ? (
            <button type="button" disabled={busy} onClick={() => onSave?.('')} className="iboard-start-screen__secondary">
              Clear objective
            </button>
          ) : null}
          <button type="submit" disabled={busy} className="iboard-start-screen__primary">{entrance ? 'Enter' : 'Save'}</button>
        </div>
        </div>
      </form>
    </StartShell>
  );
}
