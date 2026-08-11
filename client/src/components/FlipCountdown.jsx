import { useEffect, useRef, useState } from 'react';

/**
 * Flip-clock style countdown (MM:SS), matching the Teach hub espresso flip look.
 */
export default function FlipCountdown({
  className = '',
  initialSeconds = 300,
  onFinished,
  compact = false,
}) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const [duration, setDuration] = useState(initialSeconds);
  const endAtRef = useRef(null);
  const leftWhenPausedRef = useRef(initialSeconds);
  const digitsRef = useRef([]);
  const rootRef = useRef(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    leftWhenPausedRef.current = initialSeconds;
    setRemaining(initialSeconds);
    setDuration(initialSeconds);
    setRunning(false);
    endAtRef.current = null;
  }, [initialSeconds]);

  useEffect(() => {
    if (!running) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        setRunning(false);
        endAtRef.current = null;
        if (!finishedRef.current) {
          finishedRef.current = true;
          onFinished?.();
        }
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [running, onFinished]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const display = mm + ss;

  useEffect(() => {
    const els = digitsRef.current;
    if (!els?.length) return;
    display.split('').forEach((ch, i) => {
      const el = els[i];
      if (!el) return;
      ensureDigitDom(el);
      setDigit(el, ch, el._ready);
      el._ready = true;
    });
  }, [display]);

  // Build digit shells once mounted
  useEffect(() => {
    digitsRef.current.forEach((el) => ensureDigitDom(el));
    const mm0 = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss0 = String(remaining % 60).padStart(2, '0');
    (mm0 + ss0).split('').forEach((ch, i) => {
      const el = digitsRef.current[i];
      if (el) setDigit(el, ch, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  function start() {
    finishedRef.current = false;
    if (remaining <= 0) {
      leftWhenPausedRef.current = duration;
      setRemaining(duration);
    }
    const base = remaining > 0 ? remaining : duration;
    endAtRef.current = Date.now() + base * 1000;
    setRunning(true);
  }

  function pause() {
    if (!running) return;
    const left = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
    leftWhenPausedRef.current = left;
    setRemaining(left);
    setRunning(false);
    endAtRef.current = null;
  }

  function stop() {
    finishedRef.current = false;
    setRunning(false);
    endAtRef.current = null;
    leftWhenPausedRef.current = duration;
    setRemaining(duration);
  }

  function setPreset(sec) {
    finishedRef.current = false;
    setRunning(false);
    endAtRef.current = null;
    setDuration(sec);
    setRemaining(sec);
    leftWhenPausedRef.current = sec;
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} ref={rootRef}>
      <div
        className={`iboard-flip ${compact ? 'iboard-flip--compact' : ''}`}
        aria-live="polite"
        aria-label={`Timer ${mm}:${ss}`}
      >
        <div className="iboard-flip__panel">
          <div className="iboard-flip__row">
            {[0, 1].map((i) => (
              <div
                key={`m${i}`}
                className="iboard-flip__digit"
                ref={(el) => {
                  digitsRef.current[i] = el;
                }}
              />
            ))}
            <span className="iboard-flip__colon" aria-hidden="true">
              <i />
              <i />
            </span>
            {[2, 3].map((i) => (
              <div
                key={`s${i}`}
                className="iboard-flip__digit"
                ref={(el) => {
                  digitsRef.current[i] = el;
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {[60, 180, 300, 600].map((sec) => (
          <button
            key={sec}
            type="button"
            onClick={() => setPreset(sec)}
            className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
              duration === sec && !running
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {sec < 60 ? `${sec}s` : `${sec / 60}m`}
          </button>
        ))}
        {!running ? (
          <button
            type="button"
            onClick={start}
            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-bold uppercase text-white hover:bg-emerald-500"
          >
            Start
          </button>
        ) : (
          <button
            type="button"
            onClick={pause}
            className="rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-950 hover:bg-amber-400"
          >
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={stop}
          className="rounded-lg bg-slate-800 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-300 hover:bg-red-700 hover:text-white"
        >
          Stop
        </button>
      </div>
    </div>
  );
}

function ensureDigitDom(el) {
  if (!el || el._built) return;
  el.innerHTML = `
    <div class="base upper"><span>0</span></div>
    <div class="base lower"><span>0</span></div>
    <div class="flap upper"><span>0</span></div>
    <div class="flap lower"><span>0</span></div>`;
  el._val = '0';
  el._built = true;
}

function setDigit(el, next, animate) {
  ensureDigitDom(el);
  next = String(next);
  if (el._val === next) return;
  const prev = el._val;
  el._val = next;
  const topBase = el.querySelector('.base.upper span');
  const botBase = el.querySelector('.base.lower span');
  const topFlap = el.querySelector('.flap.upper span');
  const botFlap = el.querySelector('.flap.lower span');
  const flapTop = el.querySelector('.flap.upper');

  if (!animate) {
    topBase.textContent = next;
    botBase.textContent = next;
    topFlap.textContent = next;
    botFlap.textContent = next;
    return;
  }

  topFlap.textContent = prev;
  botFlap.textContent = next;
  topBase.textContent = next;
  botBase.textContent = prev;

  el.classList.remove('flip');
  void el.offsetWidth;
  el.classList.add('flip');

  const done = () => {
    botBase.textContent = next;
    topFlap.textContent = next;
    el.classList.remove('flip');
    flapTop.removeEventListener('animationend', done);
  };
  flapTop.addEventListener('animationend', done);
}
