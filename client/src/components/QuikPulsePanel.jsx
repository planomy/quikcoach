import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import HintWrap from './HintWrap.jsx';

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
    short: 'Yes/No',
    hint: 'Ask the whole class: Yes / No / Unsure',
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
    short: '1–5',
    hint: 'Ask the whole class to rate 1 to 5 (confidence, quality, readiness)',
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
    short: 'Agree',
    hint: 'Ask the whole class: strongly disagree → strongly agree',
    icon: 'agreement',
    question: {
      ...baseQuestion,
      type: 'choice',
      prompt: 'How much do you agree with the statement you just heard?',
      options: ['Strongly disagree', 'Disagree', 'Unsure', 'Agree', 'Strongly agree'],
    },
  },
  {
    id: 'choice',
    label: 'A–D Choice',
    short: 'A–D',
    hint: 'Ask a letter-choice question: pick 2, 3 or 4 options',
    icon: 'choice',
  },
  {
    id: 'one-word',
    label: 'One Word',
    short: 'One word',
    hint: 'Ask the whole class for a one-word answer',
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
    short: 'Short',
    hint: 'Ask the whole class for a short written answer',
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
    || pulseCards.some((card) => card.question?.prompt === activity.prompt);
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

function ChoiceCountPicker({ open, onClose, onPick, anchorRef }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const [box, setBox] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setBox(null);
      return undefined;
    }

    function place() {
      const rect = anchorRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 168);
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - width - 8)
      );
      const top = Math.min(rect.bottom + 6, window.innerHeight - 96);
      setBox({ top, left, width });
    }

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !box || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="rounded-xl border border-indigo-200 bg-white p-2.5 shadow-xl dark:border-indigo-800 dark:bg-slate-900"
      style={{
        position: 'fixed',
        top: box.top,
        left: box.left,
        width: box.width,
        zIndex: 80,
      }}
    >
      <p
        id={titleId}
        className="px-1 pb-2 text-center text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
      >
        How many options?
      </p>
      <div className="flex gap-1.5" aria-label="Number of choices">
        {[2, 3, 4].map((count) => (
          <HintWrap key={count} hint={`Ask now with ${count} choices: A–${String.fromCharCode(64 + count)}`} prefer="below" className="min-w-10 flex-1">
            <button
              type="button"
              aria-label={`${count} answer choices`}
              className="grid h-10 w-full place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-sm font-black text-indigo-800 transition hover:border-indigo-500 hover:bg-indigo-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
              onClick={() => onPick(count)}
            >
              {count}
            </button>
          </HintWrap>
        ))}
      </div>
    </div>,
    document.body
  );
}

/** One row of one-tap checks that ask the whole class straight away. */
export default function QuikPulsePanel({ onLaunch }) {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const choiceAnchorRef = useRef(null);

  function launchChoice(count) {
    setChoiceOpen(false);
    onLaunch({
      ...baseQuestion,
      type: 'choice',
      prompt: choicePrompt,
      options: ['A', 'B', 'C', 'D'].slice(0, count),
    });
  }

  function renderCard(card) {
    const isChoice = card.id === 'choice';
    const pressed = isChoice && choiceOpen;
    return (
      <HintWrap key={card.id} hint={card.hint} prefer="below" className="w-full min-w-0" suppressed={pressed}>
        <button
          ref={isChoice ? choiceAnchorRef : undefined}
          type="button"
          onClick={() => {
            if (isChoice) setChoiceOpen((open) => !open);
            else onLaunch(card.question);
          }}
          className={`flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-1.5 text-center shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#cfcce8] dark:focus-visible:ring-indigo-500 ${
            pressed
              ? 'border-[#5a5fc3] bg-[#ebeaf8] text-[#5a5fc3] dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200'
              : 'border-[#cfcce8] bg-white text-[#5a5fc3] hover:border-[#5a5fc3] hover:bg-[#ebeaf8] dark:border-indigo-800 dark:bg-slate-950 dark:text-indigo-300 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/50'
          }`}
          title=""
          aria-label={`${card.label}. ${card.hint}`}
          aria-expanded={isChoice ? choiceOpen : undefined}
          aria-haspopup={isChoice ? 'dialog' : undefined}
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden>
            <QuikPulseIcon name={card.icon} />
          </span>
          <span className="block w-full truncate text-[11px] font-bold leading-none text-slate-900 dark:text-white">
            {card.short}
          </span>
        </button>
      </HintWrap>
    );
  }

  return (
    <section aria-label="Quick questions">
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#6b6b78] dark:text-slate-400">
        Quick check <span className="font-semibold normal-case tracking-normal text-[#8a8a96] dark:text-slate-500">· one tap asks the whole class</span>
      </p>
      <div className="grid grid-cols-6 gap-1.5">
        {pulseCards.map(renderCard)}
      </div>
      <ChoiceCountPicker
        open={choiceOpen}
        anchorRef={choiceAnchorRef}
        onClose={() => setChoiceOpen(false)}
        onPick={launchChoice}
      />
    </section>
  );
}
