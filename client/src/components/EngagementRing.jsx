import { UNSURE_COLOR } from '../lib/liveResponseMeta.js';

const CONFIDENCE_COLOURS = {
  confident: '#10b981',
  unsure: UNSURE_COLOR,
  guessed: '#ef4444',
  answered: '#6366f1',
};

function segmentColour(segment) {
  if (!segment?.answered) return 'var(--iboard-ring-unanswered)';
  return CONFIDENCE_COLOURS[segment.confidence] || CONFIDENCE_COLOURS.answered;
}

function segmentLabel(segment, index) {
  const question = Number(segment?.questionNumber) || index + 1;
  if (!segment?.answered) return `Question ${question}: unanswered`;
  if (segment.confidence === 'confident') return `Question ${question}: confident`;
  if (segment.confidence === 'unsure') return `Question ${question}: not confident`;
  if (segment.confidence === 'guessed') return `Question ${question}: guessed`;
  return `Question ${question}: answered`;
}

function segmentedGradient(segments) {
  const count = segments.length;
  if (!count) return 'var(--iboard-ring-empty)';
  const sweep = 360 / count;
  const gap = Math.min(3, sweep * 0.1);
  const stops = segments.flatMap((segment, index) => {
    const start = index * sweep;
    const colourEnd = Math.max(start, (index + 1) * sweep - gap);
    const end = (index + 1) * sweep;
    return [
      `${segmentColour(segment)} ${start}deg ${colourEnd}deg`,
      `var(--iboard-ring-gap) ${colourEnd}deg ${end}deg`,
    ];
  });
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
}

export default function EngagementRing({ engagement, connected = true, size = 48 }) {
  const opportunities = Number(engagement?.opportunities || 0);
  const suppliedSegments = Array.isArray(engagement?.segments) ? engagement.segments : [];
  const fallbackRecent = Array.isArray(engagement?.recent) ? engagement.recent : [];
  const segments = suppliedSegments.length
    ? suppliedSegments
    : fallbackRecent.map((answered, index) => ({
        questionNumber: index + 1,
        answered: !!answered,
        confidence: '',
      }));
  const responded = segments.length
    ? segments.filter((segment) => segment.answered).length
    : Number(engagement?.responded || 0);
  const total = segments.length || opportunities;
  const confidenceCounts = segments.reduce(
    (counts, segment) => {
      if (segment?.answered) counts[segment.confidence || 'answered'] += 1;
      return counts;
    },
    { confident: 0, unsure: 0, guessed: 0, answered: 0 }
  );
  const summary = total
    ? `${responded} of ${total} questions answered; ${confidenceCounts.confident} confident, ${confidenceCounts.unsure} not confident, ${confidenceCounts.guessed} guessed`
    : 'online; no engagement opportunities yet';
  const label = connected ? summary : `offline; ${summary}`;
  const detail = segments.length
    ? `${label}. ${segments.map(segmentLabel).join('; ')}`
    : label;

  return (
    <div
      role="img"
      aria-label={detail}
      title={detail}
      className={`iboard-confidence-ring grid shrink-0 place-items-center rounded-full ${connected ? '' : 'border-2 border-dashed border-slate-300 dark:border-slate-600'}`}
      style={{
        width: size,
        height: size,
        background: connected && total ? segmentedGradient(segments) : 'var(--iboard-ring-empty)',
      }}
    >
      <div
        className="grid place-items-center rounded-full bg-white text-[11px] font-black text-slate-700 dark:bg-slate-900 dark:text-slate-200"
        style={{ width: size - 9, height: size - 9 }}
      >
        {total ? `${responded}/${total}` : '—'}
      </div>
    </div>
  );
}
