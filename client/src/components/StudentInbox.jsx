import { useRef, useState } from 'react';
import RichTextDisplay from './RichTextDisplay.jsx';
import { formatInboxTime } from '../lib/inboxTime.js';

function isImageMime(mime) {
  return String(mime || '').startsWith('image/');
}

function isPdfMime(mime, name = '') {
  return String(mime || '') === 'application/pdf' || /\.pdf$/i.test(name);
}

async function downloadMaterial(item) {
  const url = String(item.url || '');
  if (!url) throw new Error('missing url');
  const downloadUrl = `${url}${url.includes('?') ? '&' : '?'}download=1&name=${encodeURIComponent(item.originalName || 'handout')}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error('download failed');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = item.originalName || 'handout';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function saveSnapshotCard(item) {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 520;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#312e81';
  ctx.fillRect(0, 0, canvas.width, 110);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText('iBOARD handout', 40, 68);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 28px system-ui, sans-serif';
  const title = String(item.title || item.originalName || 'Handout').slice(0, 42);
  ctx.fillText(title, 40, 200);
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(String(item.originalName || '').slice(0, 48), 40, 250);
  ctx.fillText(new Date(item.at || Date.now()).toLocaleString(), 40, 290);
  ctx.fillText('Ask your teacher if you also need the original file.', 40, 360);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('snapshot failed'));
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${String(item.title || 'handout').replace(/[^\w.-]+/g, '_')}-snapshot.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      resolve();
    }, 'image/png');
  });
}

function MaterialBody({ item, large, onToggleLarge }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const previewRef = useRef(null);
  const image = isImageMime(item.mimeType);
  const pdf = isPdfMime(item.mimeType, item.originalName);
  const previewHeight = large ? 'min(70vh, 36rem)' : '16rem';

  async function onDownload() {
    setBusy('download');
    setMessage('');
    try {
      await downloadMaterial(item);
      setMessage('Saved to your device');
    } catch {
      setMessage('Download blocked — try Save snapshot instead');
    } finally {
      setBusy('');
    }
  }

  async function onSnapshot() {
    setBusy('snapshot');
    setMessage('');
    try {
      if (image && item.url) {
        const response = await fetch(item.url);
        if (!response.ok) throw new Error('fetch');
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = item.originalName || 'handout.jpg';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      } else {
        await saveSnapshotCard(item);
      }
      setMessage('Snapshot saved');
    } catch {
      setMessage('Could not save a snapshot — use your device screenshot');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-3" ref={previewRef}>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {item.originalName || 'Handout'}
        {item.size ? ` · ${Math.max(1, Math.round(item.size / 1024))} KB` : ''}
      </p>
      <div
        className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950"
        style={{ height: previewHeight }}
      >
        {image ? (
          <img src={item.url} alt={item.title || 'Handout'} className="h-full w-full object-contain" />
        ) : pdf ? (
          <iframe
            title={item.title || 'PDF handout'}
            src={item.url}
            className="h-full w-full border-0 bg-white outline-none focus:outline-none"
            tabIndex={-1}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Preview not available for this file type</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Download it, or save a snapshot card.</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={!!busy}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === 'download' ? 'Saving…' : 'Save file'}
        </button>
        <button
          type="button"
          onClick={onSnapshot}
          disabled={!!busy}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        >
          {busy === 'snapshot' ? 'Saving…' : 'Save snapshot'}
        </button>
        {typeof onToggleLarge === 'function' ? (
          <button
            type="button"
            onClick={onToggleLarge}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200"
          >
            {large ? 'Smaller view' : 'Larger view'}
          </button>
        ) : null}
      </div>
      {message ? <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{message}</p> : null}
    </div>
  );
}

export default function StudentInbox({ items, expandedId, onToggle, onDismiss, largeMaterialId, onToggleMaterialLarge }) {
  if (!items.length) {
    return <div className="h-4" aria-hidden="true" />;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const open = expandedId === item.id;
        const isBroadcast = item.type === 'broadcast';
        const isMaterial = item.type === 'material';
        const large = isMaterial && largeMaterialId === item.id;
        const timeLabel = formatInboxTime(item.at);
        const preview = isBroadcast
          ? `${item.exemplars?.length || 0} exemplar${(item.exemplars?.length || 0) === 1 ? '' : 's'}${timeLabel ? ` · ${timeLabel}` : ''}`
          : isMaterial
            ? `${item.originalName || item.title || 'Handout'}${timeLabel ? ` · ${timeLabel}` : ''}`
            : (() => {
                const text = (item.text || 'Teacher note').replace(/\s+/g, ' ').trim().slice(0, 72);
                return timeLabel ? `${text}${text ? ' · ' : ''}${timeLabel}` : text;
              })();

        return (
          <section
            key={item.id}
            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-stretch">
              <button
                type="button"
                onClick={() => onToggle(item.id)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                aria-expanded={open}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      {isBroadcast ? 'Broadcast' : isMaterial ? 'Handout' : 'Teacher note'}
                    </p>
                    {item.unread ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-label="New" />
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    {isMaterial ? (item.title || preview) : preview}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                  {open ? 'Close' : 'Open'}
                </span>
              </button>
              {!open && typeof onDismiss === 'function' ? (
                <button
                  type="button"
                  onClick={() => onDismiss(item.id)}
                  className="shrink-0 px-3 text-lg font-bold leading-none text-slate-300 transition hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300"
                  aria-label="Dismiss"
                  title="Dismiss"
                >
                  ×
                </button>
              ) : null}
            </div>
            {open && (
              <div className="space-y-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                {isMaterial ? (
                  <MaterialBody
                    item={item}
                    large={large}
                    onToggleLarge={
                      typeof onToggleMaterialLarge === 'function'
                        ? () => onToggleMaterialLarge(item.id)
                        : undefined
                    }
                  />
                ) : isBroadcast ? (
                  <>
                    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      Class exemplars — names are not shown.
                    </p>
                    {(item.exemplars || []).map((ex, i) => (
                      <div
                        key={`${ex.label}-${i}`}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400">
                          {ex.label}
                        </p>
                        {ex.image_url && (
                          <img src={ex.image_url} alt="" className="mt-2 max-h-48 w-full object-contain" />
                        )}
                        {ex.text?.trim() ? (
                          <RichTextDisplay
                            html={ex.rich_text_html}
                            text={ex.text}
                            className="mt-2 max-h-48 overflow-auto text-slate-700 dark:text-slate-300 scrollbar-thin"
                          />
                        ) : !ex.image_url ? (
                          <p className="mt-2 text-slate-500">—</p>
                        ) : null}
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                    {item.text}
                  </div>
                )}
                {typeof onDismiss === 'function' ? (
                  <button
                    type="button"
                    onClick={() => onDismiss(item.id)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
