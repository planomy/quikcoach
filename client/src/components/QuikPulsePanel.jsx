const baseQuestion = {
  correctAnswer: '',
  anonymous: false,
  optional: false,
  imageUrl: '',
  timerSeconds: 0,
};

const choicePrompt = 'Choose the option that best answers the question you just heard.';

function choiceCard(count) {
  const letters = ['A', 'B', 'C', 'D'].slice(0, count);
  return {
    id: `choice-${count}`,
    label: `${letters[0]}–${letters[letters.length - 1]} Choice`,
    hint: `${count} answer options`,
    icon: 'choice',
    question: {
      ...baseQuestion,
      type: 'choice',
      prompt: choicePrompt,
      options: letters,
    },
  };
}

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
  choiceCard(2),
  choiceCard(3),
  choiceCard(4),
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
  const cardClass = compact
    ? 'group flex min-h-[3.75rem] flex-col items-center justify-center rounded-lg border border-indigo-200 bg-white px-1.5 py-1.5 text-center text-indigo-700 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-indigo-800 dark:bg-slate-950 dark:text-indigo-300 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/50'
    : 'group flex min-h-[5.25rem] flex-col items-center justify-center rounded-xl border border-indigo-200 bg-white px-2 py-2.5 text-center text-indigo-700 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 dark:border-indigo-800 dark:bg-slate-950 dark:text-indigo-300 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/50';

  if (compact) {
    const buttonClass = 'flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-md border border-slate-200 bg-white px-1 py-1 text-center text-[10px] leading-tight font-bold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-indigo-950';
    return (
      <section aria-label="Quick questions" className="relative z-10 shrink-0 border-b border-slate-200 bg-slate-50 pl-3 pr-6 py-2 dark:border-slate-700 dark:bg-slate-950">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(65px,1fr))] gap-1.5">
          {pulseCards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => onLaunch(card.question)}
              title={`${card.label} — ${card.hint}`}
              aria-label={card.label}
              className={buttonClass}
            >
              <span aria-hidden="true" className="h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-300">
                <QuikPulseIcon name={card.icon} />
              </span>
              <span>{card.label}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-col p-3 sm:p-4" aria-label="Quick questions">
      <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2">
        {pulseCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onLaunch(card.question)}
            className={cardClass}
            title={card.hint}
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 dark:bg-indigo-950">
              <QuikPulseIcon name={card.icon} />
            </span>
            <span className="mt-1.5 text-[11px] font-black leading-tight text-slate-950 dark:text-white">
              {card.label}
            </span>
            <span className="mt-0.5 text-[9px] font-semibold leading-snug text-slate-500 dark:text-slate-400">
              {card.hint}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
