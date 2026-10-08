import HintWrap from './HintWrap.jsx';
import { CloseButton } from './PanelActions.jsx';

/** Curated “what you can do” for the teacher help panel (most important first). */
export const TEACHER_HELP_ITEMS = [
  {
    id: 'share',
    title: 'Share a PDF, image, note or question set',
    body: 'Press Share (+) on the left rail to send an image, PDF or text to student inboxes, or open Question sets for premade curriculum questions.',
    action: 'share',
  },
  {
    id: 'ask',
    title: 'Ask the class',
    body: 'Open Ask and tap a Quick check along the top (yes/no, 1–5, A–D, short answer), or write your own question underneath.',
    action: 'ask',
  },
  {
    id: 'responses',
    title: 'Read Responses',
    body: "While a question is live, click the gauge in the header to watch answers, remind anyone who hasn't responded, project responses, then tap End question. With no question live, the gauge opens Class writing.",
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
    body: 'The snowflake under Manage class in the header stops all student writing. The timer and word limit sit beside it.',
    action: 'freeze',
  },
  {
    id: 'rec',
    title: 'Learning trail',
    body: 'TUIT records how each draft grows and the support you give, automatically. Click a red Pasted tag to see what was pasted, or open Reports → Learning trail.',
  },
  {
    id: 'session',
    title: 'Save or open a lesson',
    body: 'Click the save icon at the top right to save the lesson to a file, or open one you saved earlier.',
    action: 'session',
  },
  {
    id: 'records',
    title: 'Reports',
    body: 'Click the save icon at the top right, then Save a snapshot of everyone’s writing. Open View reports on the left to browse snapshots, portfolios, participation and class insights.',
    action: 'records',
  },
  {
    id: 'ai',
    title: 'AI feedback',
    body: 'Click AI feedback on the left to copy anonymised writing for an AI tool, then paste its reply back and send the feedback to students.',
    action: 'ai',
  },
  {
    id: 'breakouts',
    title: 'Breakout rooms',
    body: 'Open Breakouts under Manage class in the header to start auto or manual rooms, or the class wall.',
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
        <span className="iboard-header-icon iboard-header-icon--help" aria-hidden="true" />
      </button>
    </HintWrap>
  );
}
