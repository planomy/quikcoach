import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import HintWrap from './HintWrap.jsx';
import DrawBoxResizeHandle, { readDrawBoxHeight } from './DrawBoxResizeHandle.jsx';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 720;
const MAX_CANVAS_HEIGHT = 1800;
const PEN_WIDTH = 5;
const ERASER_WIDTH = 30;
const IDLE_SAVE_MS = 2000;
const MAX_LIVE_SAVE_MS = 5000;
const PEN_COLOURS = [
  { id: 'black', value: '#111827', label: 'Black' },
  { id: 'red', value: '#dc2626', label: 'Red' },
  { id: 'blue', value: '#2563eb', label: 'Blue' },
  { id: 'green', value: '#16a34a', label: 'Green' },
];
const SHAPE_TOOLS = [
  { id: 'line', label: 'Line' },
  { id: 'rect', label: 'Box' },
  { id: 'circle', label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
];
const SHAPE_TOOL_IDS = new Set(SHAPE_TOOLS.map((item) => item.id));

function isShapeTool(tool) {
  return SHAPE_TOOL_IDS.has(tool);
}

function clampCanvasHeight(value) {
  return Math.min(MAX_CANVAS_HEIGHT, Math.max(CANVAS_HEIGHT, Math.round(value)));
}

function pointFromEvent(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function fillWhite(ctx, width, height) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function strokeStyle(ctx, tool, colour = '#111827') {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ink = tool === 'eraser' ? '#ffffff' : colour;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = tool === 'eraser' ? ERASER_WIDTH : PEN_WIDTH;
}

function drawShape(ctx, stroke) {
  const start = stroke.points[0];
  const end = stroke.points[stroke.points.length - 1] || start;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  ctx.beginPath();
  if (stroke.tool === 'line') {
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  } else if (stroke.tool === 'rect') {
    ctx.rect(left, top, width, height);
  } else if (stroke.tool === 'circle') {
    ctx.ellipse(
      left + width / 2,
      top + height / 2,
      Math.max(width / 2, 0.5),
      Math.max(height / 2, 0.5),
      0,
      0,
      Math.PI * 2
    );
  } else if (stroke.tool === 'triangle') {
    ctx.moveTo(left + width / 2, top);
    ctx.lineTo(left + width, top + height);
    ctx.lineTo(left, top + height);
    ctx.closePath();
  }
  ctx.stroke();
}

function drawStroke(ctx, stroke) {
  const points = stroke?.points || [];
  if (!points.length) return;
  ctx.save();
  strokeStyle(ctx, stroke.tool === 'eraser' ? 'eraser' : 'pen', stroke.colour);
  if (isShapeTool(stroke.tool)) {
    drawShape(ctx, stroke);
  } else if (points.length === 1) {
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

function ShapeIcon({ kind }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'line' ? <path d="M5 19 19 5" /> : null}
      {kind === 'rect' ? <rect x="5" y="6" width="14" height="12" rx="1" /> : null}
      {kind === 'circle' ? <circle cx="12" cy="12" r="7" /> : null}
      {kind === 'triangle' ? <path d="m12 5 8 14H4Z" /> : null}
    </svg>
  );
}

function ToolButton({ active = false, disabled = false, children, onClick, title }) {
  return (
    <HintWrap hint={title} prefer="above">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        title=""
        aria-label={title}
        className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          active
            ? 'border-indigo-600 bg-indigo-600 text-white'
            : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/60'
        }`}
      >
        {children}
      </button>
    </HintWrap>
  );
}

export default function StudentDrawPad({
  disabled = false,
  hasBoardDrawing = false,
  boxHeight: boxHeightProp = null,
  onBoxHeight = null,
  onSave,
  onClear,
  onDone,
}) {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);
  const currentStrokeRef = useRef(null);
  const activePointerRef = useRef(null);
  const dirtyRef = useRef(false);
  const idleTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const savePromiseRef = useRef(null);
  const [tool, setTool] = useState('pen');
  const [colour, setColour] = useState('#111827');
  const [boxHeightState, setBoxHeightState] = useState(readDrawBoxHeight);
  const boxHeight = boxHeightProp ?? boxHeightState;
  const setBoxHeight = onBoxHeight || setBoxHeightState;
  const [canvasHeight, setCanvasHeight] = useState(CANVAS_HEIGHT);
  const [strokeCount, setStrokeCount] = useState(0);
  const [status, setStatus] = useState('Draw with your mouse, finger or stylus');
  const [finishing, setFinishing] = useState(false);
  const canvasHeightRef = useRef(CANVAS_HEIGHT);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    fillWhite(ctx, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
    if (currentStrokeRef.current) drawStroke(ctx, currentStrokeRef.current);
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

  useLayoutEffect(() => {
    const displayW = canvasRef.current?.getBoundingClientRect().width || CANVAS_WIDTH;
    const next = clampCanvasHeight(boxHeight * (CANVAS_WIDTH / Math.max(1, displayW)));
    canvasHeightRef.current = next;
    setCanvasHeight((current) => (current === next ? current : next));
  }, [boxHeight]);

  useEffect(() => {
    redraw();
  }, [canvasHeight, redraw]);

  useEffect(() => {
    redraw();
    return () => {
      clearTimers();
      document.documentElement.classList.remove('iboard-draw-resizing');
    };
  }, [clearTimers, redraw]);

  function paintCurrent() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const stroke = currentStrokeRef.current;
    if (!ctx || !stroke) return;
    drawStroke(ctx, stroke);
  }

  function beginStroke(event) {
    if (disabled || finishing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    const point = pointFromEvent(canvas, event);
    const stroke = { tool, colour, points: [point] };
    currentStrokeRef.current = stroke;
    if (!isShapeTool(tool)) paintCurrent();
    markDirty();
  }

  function continueStroke(event) {
    if (activePointerRef.current !== event.pointerId || !currentStrokeRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    event.preventDefault();
    const point = pointFromEvent(canvas, event);
    const stroke = currentStrokeRef.current;
    if (isShapeTool(stroke.tool)) {
      stroke.points = [stroke.points[0], point];
      redraw();
    } else {
      const previous = stroke.points[stroke.points.length - 1];
      stroke.points.push(point);
      ctx.save();
      strokeStyle(ctx, stroke.tool, stroke.colour);
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.restore();
    }
    markDirty();
  }

  function finishStroke(event) {
    if (activePointerRef.current !== event.pointerId || !currentStrokeRef.current) return;
    const canvas = canvasRef.current;
    try { canvas?.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    const stroke = currentStrokeRef.current;
    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1] || start;
    const tooSmall = isShapeTool(stroke.tool) && Math.hypot(end.x - start.x, end.y - start.y) < 4;
    if (!tooSmall) {
      strokesRef.current = [...strokesRef.current, stroke];
      setStrokeCount(strokesRef.current.length);
    }
    currentStrokeRef.current = null;
    activePointerRef.current = null;
    if (tooSmall) redraw();
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

  function cancelDrawing() {
    if (finishing) return;
    clearTimers();
    onDone?.();
  }

  async function removeDrawing() {
    if (finishing || disabled) return;
    strokesRef.current = [];
    currentStrokeRef.current = null;
    setStrokeCount(0);
    redraw();
    dirtyRef.current = false;
    clearTimers();
    setFinishing(true);
    try {
      await Promise.resolve(onClear?.());
      onDone?.();
    } catch (error) {
      setStatus(error?.message || 'Could not remove drawing');
      setFinishing(false);
    }
  }

  function pickColour(nextColour) {
    setColour(nextColour);
    if (tool === 'eraser') setTool('pen');
  }

  const saveFailed = status.toLowerCase().includes('could not') || status.toLowerCase().includes('failed');

  return (
    <div className="iboard-draw-pad overflow-hidden rounded-2xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/70">
        <ToolButton active={tool === 'pen'} disabled={disabled || finishing} onClick={() => setTool('pen')} title="Draw with a pen">
          ✏ Pen
        </ToolButton>
        <div className="iboard-draw-pad__colours" role="group" aria-label="Pen colour">
          {PEN_COLOURS.map((item) => {
            const active = tool !== 'eraser' && colour === item.value;
            return (
              <HintWrap key={item.id} hint={`${item.label} pen`} prefer="above">
                <button
                  type="button"
                  disabled={disabled || finishing}
                  onClick={() => pickColour(item.value)}
                  aria-label={`${item.label} pen`}
                  aria-pressed={active}
                  title=""
                  className={`iboard-draw-pad__swatch${active ? ' is-active' : ''}`}
                  style={{ background: item.value }}
                />
              </HintWrap>
            );
          })}
        </div>
        <div className="iboard-draw-pad__shapes" role="group" aria-label="Lines and shapes">
          {SHAPE_TOOLS.map((item) => (
            <ToolButton
              key={item.id}
              active={tool === item.id}
              disabled={disabled || finishing}
              onClick={() => setTool(item.id)}
              title={`Draw a ${item.label.toLowerCase()}`}
            >
              <ShapeIcon kind={item.id} />
            </ToolButton>
          ))}
        </div>
        <ToolButton active={tool === 'eraser'} disabled={disabled || finishing} onClick={() => setTool('eraser')} title="Erase part of the drawing">
          Eraser
        </ToolButton>
        <ToolButton disabled={disabled || finishing || strokeCount === 0} onClick={undo} title="Undo the last stroke">
          ↶ Undo
        </ToolButton>
        <ToolButton disabled={disabled || finishing || strokeCount === 0} onClick={clearDrawing} title="Clear the drawing">
          Clear
        </ToolButton>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={finishing}
            onClick={cancelDrawing}
            className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            Cancel
          </button>
          {hasBoardDrawing || strokeCount > 0 ? (
            <button
              type="button"
              disabled={disabled || finishing}
              onClick={removeDrawing}
              className="min-h-10 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              Remove drawing
            </button>
          ) : null}
          <button
            type="button"
            disabled={finishing}
            onClick={done}
            className="min-h-10 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
          >
            {finishing ? 'Saving…' : '✓ Done'}
          </button>
        </div>
      </div>

      <div className="iboard-draw-pad__stage bg-slate-100 p-2 sm:p-3 dark:bg-slate-950">
        <div className="iboard-draw-box" style={{ height: boxHeight }}>
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={canvasHeight}
            onPointerDown={beginStroke}
            onPointerMove={continueStroke}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            aria-label="Drawing canvas for showing your working"
            className={`block h-full w-full rounded-xl border border-slate-300 bg-white ${disabled ? 'cursor-not-allowed opacity-70' : tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
            style={{ touchAction: 'none' }}
          />
        </div>
        <DrawBoxResizeHandle
          height={boxHeight}
          disabled={disabled || finishing}
          onHeight={setBoxHeight}
          onResizeEnd={() => {
            if (strokesRef.current.length) markDirty();
          }}
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
