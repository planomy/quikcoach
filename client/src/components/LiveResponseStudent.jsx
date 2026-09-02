import { useEffect, useRef, useState } from 'react';
import LiveResponseStudentCore from './LiveResponseStudentCore.jsx';
import './studentWorkspace.css';

function isEmbeddedStudentWorkspace(props) {
  if (props?.standalone) return false;
  if (typeof window === 'undefined') return false;
  return window.location.pathname === '/student';
}

function isTabbedStudentWorkspace(props) {
  if (!props?.standalone) return false;
  if (typeof window === 'undefined') return false;
  return window.location.pathname === '/student';
}

function supportTabButtons() {
  if (typeof document === 'undefined') return [];
  const nav = document.querySelector('nav[aria-label="Student tools"]');
  return nav ? [...nav.querySelectorAll('button')] : [];
}

function activeSupportTabLabel() {
  const active = supportTabButtons().find((button) => button.className.includes('bg-indigo-600'));
  return active?.textContent?.trim().replace(/\s*[●\d]+\s*$/, '') || '';
}

function clickSupportTab(label) {
  if (!label) return;
  const button = supportTabButtons().find((item) => item.textContent?.trim().startsWith(label));
  button?.click();
}

function TabbedStudentResponse({ socket, ...props }) {
  const [activity, setActivity] = useState(null);
  const [response, setResponse] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [catchupActivityId, setCatchupActivityId] = useState('');
  const activityIdRef = useRef('');
  const catchupActivityIdRef = useRef('');
  const bootstrappedRef = useRef(false);
  const collapseTimerRef = useRef(null);
  const catchupReturnTabRef = useRef('');

  useEffect(() => {
    const clearCollapse = () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    };

    const scheduleCollapse = (nextResponse) => {
      clearCollapse();
      const delay = nextResponse?.confidence ? 700 : 2200;
      collapseTimerRef.current = setTimeout(() => {
        collapseTimerRef.current = null;
        setCollapsed(true);
      }, delay);
    };

    const clearRespondIndicatorAndRestoreTab = () => {
      const returnTo = catchupReturnTabRef.current || activeSupportTabLabel();
      clickSupportTab('Respond');
      if (returnTo && returnTo !== 'Respond') {
        queueMicrotask(() => clickSupportTab(returnTo));
      }
    };

    const onActivity = (payload) => {
      const nextActivity = payload?.activity || null;
      const nextId = nextActivity?.id ? String(nextActivity.id) : '';
      const previousId = activityIdRef.current;
      const firstState = !bootstrappedRef.current;
      bootstrappedRef.current = true;
      activityIdRef.current = nextId;
      setActivity(nextActivity);

      if (!nextId) {
        clearCollapse();
        setResponse(null);
        setCollapsed(false);
        setCatchupActivityId('');
        catchupActivityIdRef.current = '';
        catchupReturnTabRef.current = '';
        return;
      }

      if (firstState) {
        catchupReturnTabRef.current = activeSupportTabLabel();
        catchupActivityIdRef.current = nextId;
        setCatchupActivityId(nextId);
        setTimeout(() => clickSupportTab(catchupReturnTabRef.current), 0);
        return;
      }

      if (nextId !== previousId) {
        clearCollapse();
        setResponse(null);
        setCollapsed(false);
        setCatchupActivityId('');
        catchupActivityIdRef.current = '';
        catchupReturnTabRef.current = '';
      }
    };

    const onMine = (payload) => {
      const nextActivity = payload?.activity || null;
      const nextResponse = payload?.response || null;
      const nextId = nextActivity?.id ? String(nextActivity.id) : '';
      setActivity(nextActivity);
      setResponse(nextResponse);

      if (!nextId) {
        clearCollapse();
        setCollapsed(false);
        return;
      }

      if (nextResponse) {
        scheduleCollapse(nextResponse);
        if (nextId === catchupActivityIdRef.current) {
          clearRespondIndicatorAndRestoreTab();
        } else if (activeSupportTabLabel() === 'Respond') {
          clickSupportTab('Respond');
        }
      } else {
        clearCollapse();
        setCollapsed(false);
      }
    };

    const onRealert = (payload) => {
      if (!payload?.activity?.id) return;
      clearCollapse();
      setCollapsed(false);
      setCatchupActivityId('');
      catchupActivityIdRef.current = '';
      catchupReturnTabRef.current = '';
    };

    socket.on('live:activity', onActivity);
    socket.on('live:student', onMine);
    socket.on('live:realert', onRealert);
    return () => {
      socket.off('live:activity', onActivity);
      socket.off('live:student', onMine);
      socket.off('live:realert', onRealert);
      clearCollapse();
    };
  }, [socket]);

  const closeReopenedAnswer = () => {
    if (!activity?.id || !response) return;
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
    setCollapsed(true);
  };

  const closeAnswerButton = activity?.id && response && !collapsed ? (
    <button
      type="button"
      onClick={closeReopenedAnswer}
      className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"
      aria-label="Close answer"
    >
      Close
    </button>
  ) : null;

  return (
    <>
      <div className={collapsed && activity?.id && response ? 'hidden' : undefined}>
        <LiveResponseStudentCore {...props} socket={socket} standalone headerTrailing={closeAnswerButton} />
      </div>
      {collapsed && activity?.id && response && (
        <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => {
              if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
              collapseTimerRef.current = null;
              setCollapsed(false);
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
            aria-expanded={false}
          >
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Answered · Q{activity.questionNumber || 1}
              </p>
              <p className="mt-0.5 truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {String(response.value || '').replace(/\s+/g, ' ').trim() || 'Your answer'}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
              Open
            </span>
          </button>
        </section>
      )}
    </>
  );
}

function DockedPulse({ socket, ...props }) {
  const [expanded, setExpanded] = useState(false);
  const activityIdRef = useRef('');
  const expandTimerRef = useRef(null);
  const collapseTimerRef = useRef(null);

  useEffect(() => {
    document.documentElement.classList.add('iboard-student-workspace');
    return () => document.documentElement.classList.remove('iboard-student-workspace');
  }, []);

  useEffect(() => {
    const clearExpand = () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    };
    const clearCollapse = () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    };
    const collapseSoon = () => {
      clearCollapse();
      collapseTimerRef.current = setTimeout(() => setExpanded(false), 1400);
    };
    const noteActivity = (activity, nextResponse) => {
      if (!activity?.id) {
        activityIdRef.current = '';
        clearExpand();
        clearCollapse();
        setExpanded(false);
        return;
      }
      const id = String(activity.id);
      // New questions: leave the dock collapsed. Student opens Respond via the tab badge.
      if (id !== activityIdRef.current) {
        activityIdRef.current = id;
        clearExpand();
        clearCollapse();
        setExpanded(false);
        return;
      }
      if (nextResponse?.confidence) collapseSoon();
    };

    const onActivity = (payload) => noteActivity(payload?.activity, null);
    const onMine = (payload) => noteActivity(payload?.activity, payload?.response);
    const onRealert = (payload) => {
      if (payload?.activity?.id) {
        activityIdRef.current = String(payload.activity.id);
        clearExpand();
        clearCollapse();
        setExpanded(false);
      }
    };

    socket.on('live:activity', onActivity);
    socket.on('live:student', onMine);
    socket.on('live:realert', onRealert);
    return () => {
      socket.off('live:activity', onActivity);
      socket.off('live:student', onMine);
      socket.off('live:realert', onRealert);
      clearExpand();
      clearCollapse();
    };
  }, [socket]);

  return (
    <div className={`iboard-student-pulse-dock ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <LiveResponseStudentCore
        {...props}
        socket={socket}
        compact
        collapsed={!expanded}
        onCollapse={() => setExpanded(false)}
        onExpand={() => setExpanded(true)}
      />
    </div>
  );
}

export default function LiveResponseStudent(props) {
  if (isTabbedStudentWorkspace(props)) {
    return <TabbedStudentResponse {...props} />;
  }
  if (!isEmbeddedStudentWorkspace(props)) {
    return <LiveResponseStudentCore {...props} />;
  }
  return <DockedPulse {...props} />;
}
