const baseQuestion = {
  correctAnswer: '',
  anonymous: false,
  optional: false,
  imageUrl: '',
  timerSeconds: 0,
};

const choicePrompt = 'Choose the option that best answers the question you just heard.';

const pulseCards = [
  {
    id: 'yes-no',
    label: 'Yes / No / Unsure',
    hint: 'A fast three-way check',
    icon: 'yes-no',
    question: {
      ...baseQuestion,
      type: 'choice',
      prompt: 'Respond to the question you just heard.',
      options: ['Yes', 'No', 'Unsure'],
    },
  },
  {
    id: 'rating',
    label: '1–5 Rating',
    hint: 'Confidence, quality or readiness',
    icon: 'rating',
    question: {
      ...baseQuestion,
      type: 'rating',
      prompt: 'Rate your response to the question you just heard from 1 to 5.',
      options: ['1', '2', '3', '4', '5'],
    },
  },
  {
    id: 'agreement',
    label: 'Agreement Scale',
    hint: 'Strongly disagree → strongly agree',
    icon: 'agreement',
    question: {
      ...baseQuestion,
      type: 'choice',
      prompt: 'How much do you agree with the statement you just heard?',
      options: ['Strongly disagree', 'Disagree', 'Unsure', 'Agree', 'Strongly agree'],
    },
  },
  {
    id: 'one-word',
    label: 'One Word',
    hint: 'A quick word from everyone',
    icon: 'one-word',
    question: {
      ...baseQuestion,
      type: 'short',
      prompt: 'Respond in one word to the question you just heard.',
      options: [],
    },
  },
  {
    id: 'short',
    label: 'Short Response',
    hint: 'A brief written thought',
    icon: 'short',
    question: {
      ...baseQuestion,
      type: 'short',
      prompt: 'Respond briefly to the question you just heard.',
      options: [],
    },
  },
];

export function isQuikPulseActivity(activity) {
  if (!activity?.prompt) return false;
  return activity.prompt === choicePrompt
    || pulseCards.some((card) => card.question.prompt === activity.prompt);
}

function QuikPulseIcon({ name }) {
  const shared = {
    viewBox: '0 0 64 64',
    className: 'h-full w-full',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2.5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  if (name === 'yes-no') {
    return (
      <svg {...shared}>
        <path d="M14 20h14v14H14z" />
        <path d="m17.5 27 3 3 6-7" />
        <path d="M36 20h14v14H36z" />
        <path d="m40 24 6 6m0-6-6 6" />
        <circle cx="32" cy="48" r="8" />
        <path d="M32 44.5v5M32 52.5h.01" />
      </svg>
    );
  }

  if (name === 'rating') {
    return (
      <svg {...shared}>
        <path d="M8 50h48" opacity=".35" />
        <rect x="9" y="39" width="7" height="11" rx="3.5" />
        <rect x="19" y="33" width="7" height="17" rx="3.5" />
        <rect x="29" y="27" width="7" height="23" rx="3.5" />
        <rect x="39" y="21" width="7" height="29" rx="3.5" />
        <rect x="49" y="15" width="7" height="35" rx="3.5" />
      </svg>
    );
  }

  if (name === 'agreement') {
    return (
      <svg {...shared}>
        <path d="M10 32h44" opacity=".45" />
        <circle cx="10" cy="32" r="5" />
        <circle cx="21" cy="32" r="5" />
        <circle cx="32" cy="32" r="5" />
        <circle cx="43" cy="32" r="5" />
        <circle cx="54" cy="32" r="5" fill="currentColor" />
        <path d="m7.8 32 1.5 1.6 3-3.2" strokeWidth="1.8" />
      </svg>
    );
  }

  if (name === 'choice') {
    return (
      <svg {...shared}>
        <rect x="9" y="9" width="20" height="20" rx="6" />
        <rect x="35" y="9" width="20" height="20" rx="6" />
        <rect x="9" y="35" width="20" height="20" rx="6" />
        <rect x="35" y="35" width="20" height="20" rx="6" />
        <path d="m15 23 4-9 4 9m-6.3-3h4.6M41.5 14v10m0-10h4.1c2.4 0 3.8 1 3.8 2.7s-1.4 2.7-3.8 2.7h-4.1m4.7 0c2.5 0 4 1 4 2.8S48.7 24 46.2 24h-4.7M23 39.5a7 7 0 1 0 0 11M41 40h3.5a6.5 6.5 0 0 1 0 13H41V40Z" strokeWidth="2" />
      </svg>
    );
  }

  if (name === 'one-word') {
    return (
      <svg {...shared}>
        <path d="M13 14h38a7 7 0 0 1 7 7v20a7 7 0 0 1-7 7H31L20 56v-8h-7a7 7 0 0 1-7-7V21a7 7 0 0 1 7-7Z" />
        <path d="M19 31h26" strokeWidth="4" />
      </svg>
    );
  }

  return (
    <svg {...shared}>
      <path d="M13 11h38a7 7 0 0 1 7 7v25a7 7 0 0 1-7 7H31L20 57v-7h-7a7 7 0 0 1-7-7V18a7 7 0 0 1 7-7Z" />
      <path d="M18 25h28M18 32h24M18 39h18" />
    </svg>
  );
}

export default function QuikPulsePanel({ onLaunch, compact = false }) {
  const launchChoice = (count) => onLaunch({
    ...baseQuestion,
    type: 'choice',
    prompt: choicePrompt,
    options: ['A', 'B', 'C', 'D'].slice(0, count),
  });

  const cardClass = compact
    ? 'group flex min-h-[3.75rem] flex-col items-center justify-center rounded-lg border border-indigo-100 bg-white px-1.5 py-1.5 text-center text-indigo-700 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-indigo-900 dark:bg-slate-950 dark:text-indigo-300 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/50'
    : 'group flex min-h-[5.25rem] flex-col items-center justify-center rounded-xl border border-indigo-100 bg-white px-2 py-2.5 text-center text-indigo-700 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-indigo-900 dark:bg-slate-950 dark:text-indigo-300 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/50';

  return (
    <section className={compact ? 'border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950/40' : 'flex h-full flex-col p-3 sm:p-4'}>
      {compact && (
        <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Quick</p>
      )}
      <div className={`grid grid-cols-3 content-start gap-1.5 ${compact ? '' : 'min-h-0 flex-1 gap-2 sm:grid-cols-3'}`}>
        {pulseCards.slice(0, 3).map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onLaunch(card.question)}
            className={cardClass}
            title={card.hint}
          >
            <span className={`grid place-items-center rounded-lg bg-indigo-50 dark:bg-indigo-950 ${compact ? 'h-6 w-6' : 'h-8 w-8'}`}>
              <QuikPulseIcon name={card.icon} />
            </span>
            <span className={`font-black leading-tight text-slate-950 dark:text-white ${compact ? 'mt-1 text-[10px]' : 'mt-1.5 text-[11px]'}`}>{card.label}</span>
            {!compact && <span className="mt-0.5 text-[9px] font-semibold leading-snug text-slate-500 dark:text-slate-400">{card.hint}</span>}
          </button>
        ))}

        <div className={cardClass}>
          <span className={`grid place-items-center rounded-lg bg-indigo-50 dark:bg-indigo-950 ${compact ? 'h-6 w-6' : 'h-8 w-8'}`}>
            <QuikPulseIcon name="choice" />
          </span>
          <span className={`font-black leading-tight text-slate-950 dark:text-white ${compact ? 'mt-1 text-[10px]' : 'mt-1.5 text-[11px]'}`}>A–D Choice</span>
          {!compact && <span className="mt-0.5 text-[9px] font-semibold text-slate-500 dark:text-slate-400">How many choices?</span>}
          <div className={`flex gap-1 ${compact ? 'mt-1' : 'mt-1.5'}`} aria-label="Choose number of answer options">
            {[2, 3, 4].map((count) => (
              <button key={count} type="button" onClick={() => launchChoice(count)} className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black text-indigo-800 hover:bg-indigo-600 hover:text-white dark:bg-indigo-950 dark:text-indigo-200">
                {count}
              </button>
            ))}
          </div>
        </div>

        {pulseCards.slice(3).map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onLaunch(card.question)}
            className={cardClass}
            title={card.hint}
          >
            <span className={`grid place-items-center rounded-lg bg-indigo-50 dark:bg-indigo-950 ${compact ? 'h-6 w-6' : 'h-8 w-8'}`}>
              <QuikPulseIcon name={card.icon} />
            </span>
            <span className={`font-black leading-tight text-slate-950 dark:text-white ${compact ? 'mt-1 text-[10px]' : 'mt-1.5 text-[11px]'}`}>{card.label}</span>
            {!compact && <span className="mt-0.5 text-[9px] font-semibold leading-snug text-slate-500 dark:text-slate-400">{card.hint}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
