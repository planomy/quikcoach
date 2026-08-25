import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_SIZE = { width: 1200, height: 720 };
const MAX_CANVAS_SIDE = 1600;
const SAVE_DELAY_MS = 450;

function pointFromEvent(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / Math.max(1, rect.width),
    y: ((event.clientY - rect.top) * canvas.height) / Math.max(1, rect.height),
  };
}

function applyStrokeStyle(ctx, stroke, width) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.tool === 'eraser' ? width * 5 : width;
  ctx.strokeStyle = stroke.colour;
  ctx.fillStyle = stroke.colour;
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
}

function drawStroke(ctx, stroke, width) {
  const points = stroke?.points || [];
  if (!points.length) return;
  ctx.save();
  applyStrokeStyle(ctx, stroke, width);
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

function ToolButton({ active = false, children, onClick, title, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`rounded-xl border px-3 py-2 text-sm font-black transition disabled:opacity-40 ${
        active
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

export default function TeacherDrawingMarkup({ student, socket, onClose }) {
  const canvasRef = useRef(null);
  const redrawRef = useRef(null);
  const existingMarkupRef = useRef(null);
  const includeExistingRef = useRef(false);
  const strokesRef = useRef([]);
  const currentStrokeRef = useRef(null);
  const activePointerRef = useRef(null);
  const saveTimerRef = useRef(null);
  const pendingActionRef = useRef('');
  const savingRef = useRef(false);
  const closeRequestedRef = useRef(false);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [tool, setTool] = useState('pen');
  const [colour, setColour] = useState('#dc2626');
  const [strokeCount, setStrokeCount] = useState(0);
  const [status, setStatus] = useState(student.teacher_markup_url ? 'Existing correction loaded' : 'Ready to mark up');

  const penWidth = Math.max(4, (size.width / 1200) * 7);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (includeExistingRef.current && existingMarkupRef.current) {
      ctx.drawImage(existingMarkupRef.current, 0, 0, canvas.width, canvas.height);
    }
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke, penWidth);
  }, [penWidth]);
  redrawRef.current = redraw;

  useEffect(() => {
    strokesRef.current = [];
    currentStrokeRef.current = null;
    includeExistingRef.current = false;
    existingMarkupRef.current = null;
    setStrokeCount(0);
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    if (!student.teacher_markup_url) {
      setStatus('Ready to mark up');
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      existingMarkupRef.current = image;
      includeExistingRef.current = true;
      redrawRef.current?.();
      setStatus('Existing correction loaded');
    };
    image.onerror = () => {
      if (!cancelled) setStatus('Could not load the existing correction');
    };
    image.src = student.teacher_markup_url;
    return () => { cancelled = true; };
  }, [student.image_url, student.teacher_markup_url]);

  // Changing the canvas dimensions clears its pixels. Restore the existing layer and
  // any new strokes after the student's image reports its real aspect ratio.
  useEffect(() => {
    redraw();
  }, [size.width, size.height, redraw]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  function finishOrClose(success) {
    savingRef.current = false;
    if (!success) {
      closeRequestedRef.current = false;
      return;
    }
    if (pendingActionRef.current) {
      void flushPending();
      return;
    }
    if (closeRequestedRef.current) onClose?.();
  }

  function flushPending() {
    if (savingRef.current || !pendingActionRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const action = pendingActionRef.current;
    pendingActionRef.current = '';
    savingRef.current = true;
    setStatus(action === 'clear' ? 'Clearing correction…' : 'Sending correction…');
    if (action === 'clear') {
      socket.emit(
        'teacher:drawing-markup-clear',
        { studentId: student.id, baseImageUrl: student.image_url },
        (ack) => {
          if (!ack?.ok) setStatus(ack?.error || 'Could not clear correction');
          else setStatus('Correction cleared from student screen');
          finishOrClose(!!ack?.ok);
        }
      );
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      setStatus('Could not read the markup canvas');
      finishOrClose(false);
      return;
    }
    socket.emit(
      'teacher:drawing-markup',
      {
        studentId: student.id,
        imageBase64: canvas.toDataURL('image/png'),
        mimeType: 'image/png',
        baseImageUrl: student.image_url,
      },
      (ack) => {
        if (!ack?.ok) setStatus(ack?.error || 'Could not send correction');
        else setStatus('Saved and visible on student screen');
        finishOrClose(!!ack?.ok);
      }
    );
  }

  function queueSave(action) {
    pendingActionRef.current = action;
    setStatus('Correction pending…');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushPending();
    }, SAVE_DELAY_MS);
  }

  function beginStroke(event) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    const stroke = { tool, colour, points: [pointFromEvent(canvas, event)] };
    currentStrokeRef.current = stroke;
    const ctx = canvas.getContext('2d');
    if (ctx) drawStroke(ctx, stroke, penWidth);
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
    applyStrokeStyle(ctx, currentStrokeRef.current, penWidth);
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
  }

  function finishStroke(event) {
    if (activePointerRef.current !== event.pointerId || !currentStrokeRef.current) return;
    try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
    currentStrokeRef.current = null;
    activePointerRef.current = null;
    setStrokeCount(strokesRef.current.length);
    queueSave('save');
  }

  function undo() {
    if (!strokesRef.current.length) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redraw();
    queueSave(strokesRef.current.length || includeExistingRef.current ? 'save' : 'clear');
  }

  function clearMarkup() {
    includeExistingRef.current = false;
    existingMarkupRef.current = null;
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
    queueSave('clear');
  }

  function done() {
    closeRequestedRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (pendingActionRef.current) void flushPending();
    else if (!savingRef.current) onClose?.();
  }

  function handleBaseImageLoad(event) {
    const image = event.currentTarget;
    const scale = Math.min(1, MAX_CANVAS_SIDE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    setSize({
      width: Math.max(1, Math.round(image.naturalWidth * scale)),
      height: Math.max(1, Math.round(image.naturalHeight * scale)),
    });
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:items-center sm:p-6">
      <section className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="drawing-markup-title">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="mr-2 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Drawing feedback</p>
            <h2 id="drawing-markup-title" className="truncate font-display text-lg font-black text-slate-950 dark:text-white">Mark up {student.name}&apos;s working</h2>
          </div>
          <ToolButton active={tool === 'pen' && colour === '#dc2626'} onClick={() => { setTool('pen'); setColour('#dc2626'); }} title="Red pen">Red pen</ToolButton>
          <ToolButton active={tool === 'pen' && colour === '#2563eb'} onClick={() => { setTool('pen'); setColour('#2563eb'); }} title="Blue pen">Blue pen</ToolButton>
          <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Erase teacher markup">Eraser</ToolButton>
          <ToolButton disabled={!strokeCount} onClick={undo} title="Undo your last stroke">↶ Undo</ToolButton>
          <ToolButton disabled={!strokeCount && !includeExistingRef.current} onClick={clearMarkup} title="Remove all teacher markup">Clear markup</ToolButton>
          <button type="button" onClick={done} className="ml-auto rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700">Done</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 dark:bg-slate-950 sm:p-5">
          <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-lg" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
            <img src={student.image_url} alt={`${student.name}'s drawing`} onLoad={handleBaseImageLoad} className="absolute inset-0 h-full w-full object-fill" />
            <canvas
              ref={canvasRef}
              width={size.width}
              height={size.height}
              onPointerDown={beginStroke}
              onPointerMove={continueStroke}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              className={`absolute inset-0 h-full w-full ${tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
              style={{ touchAction: 'none' }}
              aria-label="Draw teacher corrections over the student's working"
            />
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2.5 text-xs dark:border-slate-700">
          <span className="text-slate-500 dark:text-slate-400">Your marks are a separate layer. The student&apos;s original drawing is never changed.</span>
          <span className="font-bold text-indigo-600 dark:text-indigo-300" aria-live="polite">{status}</span>
        </footer>
      </section>
    </div>
  );
}
