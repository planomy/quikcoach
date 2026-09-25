import HintWrap from './HintWrap.jsx';
import { CloseButton } from './PanelActions.jsx';

/** Curated “what you can do” for the teacher help panel (most important first). */
export const TEACHER_HELP_ITEMS = [
  {
    id: 'share',
    title: 'Share a PDF, image, or note',
    body: 'Use PDF, Image, or Text on the left rail. Send to Inbox so it lands with every student.',
  },
  {
    id: 'ask',
    title: 'Ask the class',
    body: 'Open Ask and pick a Quick check (yes/no, 1–5, A–D, short answer) or write your own.',
  },
  {
    id: 'responses',
    title: 'Read Responses',
    body: 'Open Responses to watch live answers, remind anyone still out, then tap Done when finished.',
  },
  {
    id: 'chat',
    title: 'Chat with one student',
    body: 'On their writing card, open Chat for a private conversation without stopping the class.',
  },
  {
    id: 'comment',
    title: 'Comment on their writing',
    body: 'Open a full draft, select text, and add a comment. Students see it on their work.',
  },
  {
    id: 'freeze',
    title: 'Freeze the board',
    body: 'In Session, freeze so students stop editing while you talk or show something.',
  },
  {
    id: 'rec',
    title: 'Record drafting (REC)',
    body: 'Turn REC on in the header to capture how writing builds over time, then stop when done.',
  },
  {
    id: 'session',
    title: 'Save / load the session',
    body: 'In Session, save an .iboard file to keep the lesson, or load one to restore it later.',
  },
  {
    id: 'records',
    title: 'Lesson records',
    body: 'Snapshot the class writing and open past lesson packs from Session → Lesson records.',
    action: 'records',
  },
  {
    id: 'ai',
    title: 'AI feedback',
    body: 'Prepare anonymised writing for an AI tool, then paste and distribute feedback to students.',
    action: 'ai',
  },
  {
    id: 'breakouts',
    title: 'Breakout rooms',
    body: 'In Session, start auto or manual rooms so students write in smaller groups.',
  },
  {
    id: 'tour',
    title: 'Replay the board tour',
    body: 'Run the short first-visit highlights on Share, Ask, View/Timer/Session, and REC again.',
    action: 'tour',
  },
];

/**
 * Sliding help sheet: things a teacher can do, most important first.
 */
export default function TeacherHelpPanel({
  open,
  onClose,
  panelRef,
  style,
  onAction,
}) {
  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="iboard-header-dock iboard-header-dock--end iboard-help-panel fixed z-[60]"
      style={style}
      role="dialog"
      aria-label="How to use TUIT"
    >
      <div className="iboard-help-panel__chrome">
        <h2>How to use TUIT</h2>
        <CloseButton onClick={onClose} className="iboard-help-panel__close" />
      </div>
      <ul className="iboard-help-panel__list">
        {TEACHER_HELP_ITEMS.map((item) => {
          const actionable = Boolean(item.action && onAction);
          const Row = actionable ? 'button' : 'div';
          return (
            <li key={item.id}>
              <Row
                type={actionable ? 'button' : undefined}
                className={`iboard-help-panel__item${actionable ? ' is-action' : ''}`}
                onClick={actionable ? () => onAction(item.action) : undefined}
              >
                <span className="iboard-help-panel__title">{item.title}</span>
                <span className="iboard-help-panel__body">{item.body}</span>
              </Row>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Header ? control that toggles the help panel. */
export function TeacherHelpButton({ open, onClick, buttonRef }) {
  return (
    <HintWrap hint="How to use TUIT" prefer="below" suppressed={open}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        aria-expanded={open}
        data-active={open ? 'true' : 'false'}
        className="iboard-header-icon-button flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl transition dark:text-slate-300 dark:hover:bg-[#5a5fc3] dark:hover:text-white"
        aria-label="How to use TUIT"
      >
        <span className="iboard-help-glyph" aria-hidden="true">
          ?
        </span>
      </button>
    </HintWrap>
  );
}
