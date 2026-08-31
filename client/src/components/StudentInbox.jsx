import RichTextDisplay from './RichTextDisplay.jsx';

function formatTime(at) {
  if (!Number.isFinite(Number(at)) || Number(at) <= 0) return '';
  return new Date(Number(at)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function StudentInbox({ items, expandedId, onToggle }) {
  if (!items.length) {
    return <div className="h-4" aria-hidden="true" />;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const open = expandedId === item.id;
        const isBroadcast = item.type === 'broadcast';
        return (
          <section
            key={item.id}
            className={`overflow-hidden rounded-2xl border shadow-sm ${
              isBroadcast
                ? 'border-violet-200 bg-violet-50/90 dark:border-violet-800 dark:bg-violet-950/40'
                : 'border-indigo-200 bg-indigo-50/90 dark:border-indigo-800 dark:bg-indigo-950/40'
            }`}
          >
            <button
              type="button"
              onClick={() => onToggle(item.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              aria-expanded={open}
            >
              <div className="min-w-0">
                <p className={`font-display text-sm font-black ${isBroadcast ? 'text-violet-950 dark:text-violet-100' : 'text-indigo-950 dark:text-indigo-100'}`}>
                  {isBroadcast ? 'Broadcast' : 'Note'}
                  {item.unread ? <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" aria-label="New" /> : null}
                </p>
                <p className={`truncate text-[11px] font-semibold ${isBroadcast ? 'text-violet-700 dark:text-violet-300' : 'text-indigo-700 dark:text-indigo-300'}`}>
                  {isBroadcast
                    ? `${item.exemplars?.length || 0} exemplar${(item.exemplars?.length || 0) === 1 ? '' : 's'}${formatTime(item.at) ? ` · ${formatTime(item.at)}` : ''}`
                    : (item.text || 'Teacher note').slice(0, 80)}
                </p>
              </div>
              <span className={`shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-black shadow-sm ${isBroadcast ? 'text-violet-800' : 'text-indigo-800'}`}>
                {open ? 'Close' : 'Open'}
              </span>
            </button>
            {open && (
              <div className="space-y-3 border-t border-black/5 px-4 py-3 dark:border-white/10">
                {isBroadcast ? (
                  <>
                    <p className="text-xs leading-relaxed text-violet-800 dark:text-violet-300">
                      Anonymised exemplar drafts for the class. Names are not shown.
                    </p>
                    {(item.exemplars || []).map((ex, i) => (
                      <div
                        key={`${ex.label}-${i}`}
                        className="rounded-xl border border-violet-100 bg-white p-3 text-sm shadow-sm dark:border-violet-900 dark:bg-slate-900"
                      >
                        <p className="text-xs font-bold uppercase tracking-wide text-violet-700">{ex.label}</p>
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
                  <div className="rounded-xl bg-white p-3 text-sm text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                    {item.text}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
