import HintWrap from './HintWrap.jsx';
import { CloseButton } from './PanelActions.jsx';

/** Curated “what you can do” for the teacher help panel (most important first). */
export const TEACHER_HELP_ITEMS = [
  {
    id: 'share',
    title: 'Share a PDF, image, or note',
    body: 'Use PDF, Image, or Text on the left rail to send materials to student inboxes.',
    action: 'share',
  },
  {
    id: 'ask',
    title: 'Ask the class',
    body: 'Open Ask and pick a Quick check (yes/no, 1–5, A–D, short answer) or write your own. Select from premade curriculum question sets or make your own.',
    action: 'ask',
  },
  {
    id: 'responses',
    title: 'Read Responses',
    body: "Open Responses to watch live answers, remind anyone who hasn't responded, project responses then tap Done when finished.",
    action: 'responses',
  },
  {
    id: 'chat',
    title: 'Chat with one student',
    body: 'On their writing card, open Chat for a private conversation without stopping the class.',
  },
  {
    id: 'comment',
    title: 'Comment on their writing',
    body: "On a student's card, select text and send them a comment. Once dealt with, confirm the fix or ask them to check again.",
  },
  {
    id: 'freeze',
    title: 'Freeze the board',
    body: 'Open Session, freeze the board to stop all student board writing.',
    action: 'freeze',
  },
  {
    id: 'rec',
    title: 'Record drafting (REC)',
    body: 'Turn REC on in the header to capture progression of student drafting.',
  },
  {
    id: 'session',
    title: 'Save / load the session',
    body: 'Open Session to save an .iboard file to keep the lesson, or load one to restore it later.',
    action: 'session',
  },
  {
    id: 'records',
    title: 'Lesson records',
    body: 'Open Session/Lesson Records to snapshot the class writing and open past lesson snapshots.',
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
    body: 'Open Session, start auto or manual breakout rooms allowing students to write collaboratively with peers.',
    action: 'breakouts',
  },
  {
    id: 'tour',
    title: 'Replay the board tour',
    body: 'Run the short animated tour of the Teacher board.',
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
