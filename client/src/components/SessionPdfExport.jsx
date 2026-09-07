import { useEffect, useRef, useState } from 'react';
import { emitAck } from '../lib/iboardSession.js';

const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800';
export default function SessionPdfExport({ socket, onClose }) {
  const dialog = useRef(null);
  const [pack, setPack] = useState(null);
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [detailed, setDetailed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const prior = document.activeElement;
    dialog.current?.showModal();
    return () => prior?.focus?.();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError(''); setPack(null); setPeople([]); setSelected([]);
    (async () => {
      if (!socket.connected) throw new Error('Reconnect to export this session.');
      const [ack, renderer] = await Promise.all([emitAck(socket, 'teacher:session-export'), import('../lib/sessionPdf.js')]);
      if (!ack?.ok || !ack.pack) throw new Error(ack?.error || 'Could not capture the session.');
      if (cancelled) return;
      const students = renderer.reportStudents(ack.pack);
      setPack(ack.pack); setPeople(students); setSelected(students.map(s => s.key));
    })().catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [socket, reload]);
  async function download() {
    setBusy(true); setError(''); setMessage('Preparing PDF…');
    try {
      const { downloadSessionPdf } = await import('../lib/sessionPdf.js');
      await new Promise(resolve => setTimeout(resolve, 0));
      await downloadSessionPdf(pack, { selectedKeys: selected, detailed });
      setMessage('PDF downloaded. Keep the .iboard file too if you want to reopen the lesson.');
    } catch (e) { setError(e.message || 'Could not export the PDF.'); setMessage(''); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="session-pdf-title" className="m-auto max-h-[90dvh] w-[min(36rem,94vw)] overflow-y-auto rounded-xl border border-slate-300 bg-white p-5 text-slate-800 shadow-2xl backdrop:bg-black/50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
    <div className="flex items-center justify-between gap-3"><h2 id="session-pdf-title" className="text-lg font-bold">Export session report (PDF)</h2><button type="button" className={buttonClass} onClick={onClose}>Close</button></div>
    <p className="my-3 text-sm text-slate-500 dark:text-slate-400">Includes writing, student images and compact named Draft Trails, with inline feedback linked to subsequent passage revisions.</p>
    {pack && <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Session captured {new Date(pack.exportedAt).toLocaleString()}. Reopen this window to capture later changes.</p>}
    {error && <div role="alert" className="my-3 text-sm text-red-600 dark:text-red-300">{error} {!pack && <button type="button" className={buttonClass} onClick={() => setReload(n => n + 1)}>Retry</button>}</div>}
    {busy && !pack && <p role="status">Capturing session…</p>}
    {!!people.length && <>
      <div className="mb-2 flex items-center gap-3"><button type="button" disabled={busy} className={buttonClass} onClick={() => setSelected(people.map(s => s.key))}>Whole class</button><button type="button" disabled={busy} className={buttonClass} onClick={() => setSelected([])}>Clear selection</button><span className="text-sm">{selected.length} selected</span></div>
      <fieldset disabled={busy} className="max-h-60 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700"><legend className="px-1 text-sm font-semibold">Students</legend>
        {people.map(s => <label key={s.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(s.key)} onChange={e => setSelected(current => e.target.checked ? [...current, s.key] : current.filter(key => key !== s.key))} />{s.name}{s.archived ? ' (archived trail)' : ''}</label>)}
      </fieldset>
      <label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={detailed} onChange={e => setDetailed(e.target.checked)} className="mt-1" /><span>More Draft Trail checkpoints<br /><span className="text-slate-500 dark:text-slate-400">Default: up to 3 meaningful revision extracts. Detailed selects up to 20 checkpoints with short passages — never reprints the whole draft each time.</span></span></label>
    </>}
    {!busy && pack && !people.length && <p className="my-5 text-sm">No students or archived Draft Trails in this session yet.</p>}
    <button type="button" disabled={busy || !pack || !selected.length} onClick={download} className="mt-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50">{busy && pack ? 'Creating PDF…' : 'Download PDF'}</button>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </dialog>;
}
