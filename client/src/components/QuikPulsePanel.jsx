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
    short: 'Word',
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

// Sizes give each icon about the same visual weight, since their shapes differ.
const QUIK_ICON_SIZE = {
  'yes-no': [22, 19],
  rating: [26, 16],
  agreement: [38, 8],
  choice: [20, 20],
  'one-word': [22, 17],
  short: [21, 17],
};

function QuikPulseIcon({ name }) {
  const src = `/brand/ask/${name}.png?v=2`;
  const [width, height] = QUIK_ICON_SIZE[name] || [20, 20];
  return (
    <span
      className="block max-w-full bg-current"
      style={{
        width,
        height,
        WebkitMask: `url("${src}") center / contain no-repeat`,
        mask: `url("${src}") center / contain no-repeat`,
      }}
    />
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
          className={`flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-1.5 text-center shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9d6f2] dark:focus-visible:ring-indigo-500 ${
            pressed
              ? 'border-[#2f5fee] bg-[#e8eefc] text-[#2f5fee] dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200'
              : 'border-[#c9d6f2] bg-white text-[#2f5fee] hover:border-[#2f5fee] hover:bg-[#e8eefc] dark:border-indigo-800 dark:bg-slate-950 dark:text-indigo-300 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/50'
          }`}
          title=""
          aria-label={`${card.label}. ${card.hint}`}
          aria-expanded={isChoice ? choiceOpen : undefined}
          aria-haspopup={isChoice ? 'dialog' : undefined}
        >
          <span className="grid h-5 w-full shrink-0 place-items-center" aria-hidden>
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
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#6e6e73] dark:text-slate-400">
        Quick check <span className="font-semibold normal-case tracking-normal text-[#86868b] dark:text-slate-500">· one tap asks the whole class</span>
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
