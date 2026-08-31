import { useCallback, useEffect, useRef, useState } from 'react';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 720;
const PEN_WIDTH = 5;
const ERASER_WIDTH = 30;
const IDLE_SAVE_MS = 2000;
const MAX_LIVE_SAVE_MS = 5000;

function pointFromEvent(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function fillWhite(ctx) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.restore();
}

function strokeStyle(ctx, tool) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : '#111827';
  ctx.fillStyle = tool === 'eraser' ? '#ffffff' : '#111827';
  ctx.lineWidth = tool === 'eraser' ? ERASER_WIDTH : PEN_WIDTH;
}

function drawStroke(ctx, stroke) {
  const points = stroke?.points || [];
  if (!points.length) return;
  ctx.save();
  strokeStyle(ctx, stroke.tool);
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function ToolButton({ active = false, disabled = false, children, onClick, title }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/60'
      }`}
    >
      {children}
    </button>
  );
}

export default function StudentDrawPad({ disabled = false, onSave, onClear, onDone }) {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);
  const currentStrokeRef = useRef(null);
  const activePointerRef = useRef(null);
  const dirtyRef = useRef(false);
  const idleTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const savePromiseRef = useRef(null);
  const [tool, setTool] = useState('pen');
  const [strokeCount, setStrokeCount] = useState(0);
  const [status, setStatus] = useState('Draw with your mouse, finger or stylus');
  const [finishing, setFinishing] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    fillWhite(ctx);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
  }, []);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const saveNow = useCallback(async () => {
    clearTimers();
    if (!dirtyRef.current) return true;

    if (savePromiseRef.current) {
      try {
        await savePromiseRef.current;
      } catch {
        /* the next save below will retry the latest canvas */
      }
    }

    if (!dirtyRef.current) return true;
    const canvas = canvasRef.current;
    if (!canvas) return false;

    dirtyRef.current = false;
    setStatus('Saving…');
    const hasDrawing =
      strokesRef.current.length > 0 ||
      (currentStrokeRef.current?.points?.length || 0) > 0;
    const task = hasDrawing
      ? Promise.resolve(onSave?.(canvas.toDataURL('image/jpeg', 0.82)))
      : Promise.resolve(onClear?.());
    savePromiseRef.current = task;

    try {
      await task;
      setStatus('Saved');
      return true;
    } catch (error) {
      dirtyRef.current = true;
      setStatus(error?.message || 'Could not save drawing');
      return false;
    } finally {
      if (savePromiseRef.current === task) savePromiseRef.current = null;
    }
  }, [clearTimers, onClear, onSave]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setStatus('Drawing…');
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      void saveNow();
    }, IDLE_SAVE_MS);
    if (!maxTimerRef.current) {
      maxTimerRef.current = setTimeout(() => {
        void saveNow();
      }, MAX_LIVE_SAVE_MS);
    }
  }, [saveNow]);

  useEffect(() => {
    redraw();
    return () => clearTimers();
  }, [clearTimers, redraw]);

  function beginStroke(event) {
    if (disabled || finishing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    const point = pointFromEvent(canvas, event);
    const stroke = { tool, points: [point] };
    currentStrokeRef.current = stroke;
    const ctx = canvas.getContext('2d');
    if (ctx) drawStroke(ctx, stroke);
    markDirty();
  }

  function continueStroke(event) {
    if (activePointerRef.current !== event.pointerId || !currentStrokeRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    event.preventDefault();
    const point = pointFromEvent(canvas, event);
    const points = currentStrokeRef.current.points;
    const previous = points[points.length - 1];
    points.push(point);
    ctx.save();
    strokeStyle(ctx, currentStrokeRef.current.tool);
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
    markDirty();
  }

  function finishStroke(event) {
    if (activePointerRef.current !== event.pointerId || !currentStrokeRef.current) return;
    const canvas = canvasRef.current;
    try { canvas?.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
    currentStrokeRef.current = null;
    activePointerRef.current = null;
    setStrokeCount(strokesRef.current.length);
    markDirty();
  }

  function undo() {
    if (disabled || finishing || !strokesRef.current.length) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redraw();
    markDirty();
  }

  function clearDrawing() {
    if (disabled || finishing || !strokesRef.current.length) return;
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
    markDirty();
  }

  async function done() {
    if (finishing) return;
    if (disabled) {
      clearTimers();
      onDone?.();
      return;
    }
    setFinishing(true);
    const saved = await saveNow();
    if (saved) onDone?.();
    else setFinishing(false);
  }

  const saveFailed = status.toLowerCase().includes('could not') || status.toLowerCase().includes('failed');

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/70">
        <ToolButton active={tool === 'pen'} disabled={disabled || finishing} onClick={() => setTool('pen')} title="Draw with a pen">
          ✏ Pen
        </ToolButton>
        <ToolButton active={tool === 'eraser'} disabled={disabled || finishing} onClick={() => setTool('eraser')} title="Erase part of the drawing">
          Eraser
        </ToolButton>
        <ToolButton disabled={disabled || finishing || strokeCount === 0} onClick={undo} title="Undo the last stroke">
          ↶ Undo
        </ToolButton>
        <ToolButton disabled={disabled || finishing || strokeCount === 0} onClick={clearDrawing} title="Clear the drawing">
          Clear
        </ToolButton>
        <button
          type="button"
          disabled={finishing}
          onClick={done}
          className="ml-auto min-h-10 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
        >
          {finishing ? 'Saving…' : '✓ Done'}
        </button>
      </div>

      <div className="bg-slate-100 p-2 sm:p-3 dark:bg-slate-950">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onPointerDown={beginStroke}
          onPointerMove={continueStroke}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          aria-label="Drawing canvas for showing your working"
          className={`block w-full rounded-xl border border-slate-300 bg-white ${disabled ? 'cursor-not-allowed opacity-70' : tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
          style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`, touchAction: 'none' }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
        <span className="text-slate-500 dark:text-slate-400">Teacher sees updates live · your preview appears when you tap Done</span>
        <span className={`font-semibold ${saveFailed ? 'text-red-600' : 'text-indigo-600 dark:text-indigo-300'}`} aria-live="polite">
          {disabled ? 'Class is frozen' : status}
        </span>
      </div>
    </div>
  );
}
