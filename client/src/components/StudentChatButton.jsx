import { useEffect, useState } from 'react';
import ConversationModal, { ChatIcon } from './ConversationModal.jsx';
import HintWrap from './HintWrap.jsx';

export default function StudentChatButton({ socket, studentId, unread = false, onOpen }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onOpenChat() {
      setOpen(true);
      onOpen?.();
    }
    window.addEventListener('iboard:open-student-chat', onOpenChat);
    return () => window.removeEventListener('iboard:open-student-chat', onOpenChat);
  }, [onOpen]);

  return (
    <>
      <HintWrap hint={unread ? 'Chat with teacher — new message' : 'Chat with teacher'} prefer="above" suppressed={open}>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onOpen?.();
        }}
        className={`relative ml-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border shadow-sm transition ${
          unread
            ? 'border-[#cfcce8] bg-[#ebeaf8] text-[#5a5fc3] dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
        }`}
        aria-label={unread ? 'Chat with teacher — new message' : 'Chat with teacher'}
        title=""
      >
        <ChatIcon className="h-4 w-4" />
        {unread ? (
          <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-900" aria-hidden="true" />
        ) : null}
      </button>
      </HintWrap>
      <ConversationModal
        open={open}
        onClose={() => setOpen(false)}
        socket={socket}
        role="student"
        studentId={studentId}
        title="Teacher"
        subtitle="Private"
      />
    </>
  );
}
