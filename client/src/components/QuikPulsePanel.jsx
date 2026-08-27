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
    hint: 'From strongly disagree to strongly agree',
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
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className: 'h-12 w-12',
  };

  if (name === 'yes-no') {
    return (
      <svg {...shared}>
        <circle cx="14" cy="32" r="9" />
        <circle cx="32" cy="32" r="9" />
        <circle cx="50" cy="32" r="9" />
        <path d="m10.5 32 2.3 2.5 4.8-5" />
        <path d="m28.8 28.8 6.4 6.4m0-6.4-6.4 6.4" />
        <path d="M47.8 29.7c.5-1.8 4.4-2 4.4.5 0 1.7-2.2 1.8-2.2 3.5m0 2.7h.01" />
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

function PulseCard({ card, onLaunch }) {
  return (
    <button
      type="button"
      onClick={() => onLaunch(card.question)}
      className="group flex min-h-36 flex-col items-center justify-center rounded-[1.4rem] border-2 border-indigo-100 bg-white px-3 py-4 text-center text-indigo-700 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-400 hover:bg-indigo-50 hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 dark:border-indigo-900 dark:bg-slate-950 dark:text-indigo-300 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/50"
    >
      <span className="grid h-14 w-14 place-items-center rounded-[1.1rem] bg-indigo-50 transition group-hover:bg-white dark:bg-indigo-950 dark:group-hover:bg-indigo-900/70">
        <QuikPulseIcon name={card.icon} />
      </span>
      <span className="mt-3 text-sm font-black text-slate-950 dark:text-white">{card.label}</span>
      <span className="mt-1 text-[11px] font-semibold leading-snug text-slate-500 dark:text-slate-400">{card.hint}</span>
    </button>
  );
}

export default function QuikPulsePanel({ onLaunch, onClose }) {
  const launchChoice = (count) => onLaunch({
    ...baseQuestion,
    type: 'choice',
    prompt: choicePrompt,
    options: ['A', 'B', 'C', 'D'].slice(0, count),
  });

  return (
    <section className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-indigo-100 pb-4 dark:border-indigo-900">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">Quik Pulse</p>
          <h3 className="font-display text-xl font-black text-slate-950 dark:text-white">Speak the question. Tap the response.</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Participants can answer immediately—nothing for you to type.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">Close</button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {pulseCards.slice(0, 3).map((card) => <PulseCard key={card.id} card={card} onLaunch={onLaunch} />)}

        <div className="flex min-h-36 flex-col items-center justify-center rounded-[1.4rem] border-2 border-indigo-100 bg-white px-3 py-4 text-center text-indigo-700 shadow-sm dark:border-indigo-900 dark:bg-slate-950 dark:text-indigo-300">
          <span className="grid h-14 w-14 place-items-center rounded-[1.1rem] bg-indigo-50 dark:bg-indigo-950">
            <QuikPulseIcon name="choice" />
          </span>
          <span className="mt-3 text-sm font-black text-slate-950 dark:text-white">A–D Choice</span>
          <span className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">How many choices did you say?</span>
          <div className="mt-3 flex gap-2" aria-label="Choose number of answer options">
            {[2, 3, 4].map((count) => (
              <button key={count} type="button" onClick={() => launchChoice(count)} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-800 hover:bg-indigo-600 hover:text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200">
                {count}
              </button>
            ))}
          </div>
        </div>

        {pulseCards.slice(3).map((card) => <PulseCard key={card.id} card={card} onLaunch={onLaunch} />)}
      </div>
    </section>
  );
}
