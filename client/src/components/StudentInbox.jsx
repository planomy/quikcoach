import RichTextDisplay from './RichTextDisplay.jsx';
import { formatInboxTime } from '../lib/inboxTime.js';

export default function StudentInbox({ items, expandedId, onToggle, onDismiss }) {
  if (!items.length) {
    return <div className="h-4" aria-hidden="true" />;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const open = expandedId === item.id;
        const isBroadcast = item.type === 'broadcast';
        const timeLabel = formatInboxTime(item.at);
        const preview = isBroadcast
          ? `${item.exemplars?.length || 0} exemplar${(item.exemplars?.length || 0) === 1 ? '' : 's'}${timeLabel ? ` · ${timeLabel}` : ''}`
          : (() => {
              const text = (item.text || 'Teacher note').replace(/\s+/g, ' ').trim().slice(0, 72);
              return timeLabel ? `${text}${text ? ' · ' : ''}${timeLabel}` : text;
            })();

        return (
          <section
            key={item.id}
            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <span
              aria-hidden="true"
              className={`absolute bottom-0 left-0 top-0 w-1 ${isBroadcast ? 'bg-slate-300 dark:bg-slate-600' : 'bg-indigo-500'}`}
            />
            <div className="flex items-stretch pl-1">
              <button
                type="button"
                onClick={() => onToggle(item.id)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 pl-4 text-left"
                aria-expanded={open}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      {isBroadcast ? 'Broadcast' : 'Teacher note'}
                    </p>
                    {item.unread ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-label="New" />
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    {preview}
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
              <div className="space-y-3 border-t border-slate-100 px-4 py-3 pl-5 dark:border-slate-800">
                {isBroadcast ? (
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
