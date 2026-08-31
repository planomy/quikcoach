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
        catchupReturnTabRef.current = '';
        return;
      }

      if (firstState) {
        catchupReturnTabRef.current = activeSupportTabLabel();
        setCatchupActivityId(nextId);
        setTimeout(() => clickSupportTab(catchupReturnTabRef.current), 0);
        return;
      }

      if (nextId !== previousId) {
        clearCollapse();
        setResponse(null);
        setCollapsed(false);
        setCatchupActivityId('');
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
        if (nextId === catchupActivityId || nextId === activityIdRef.current) {
          clearRespondIndicatorAndRestoreTab();
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
  }, [socket, catchupActivityId]);

  return (
    <>
      {catchupActivityId && (
        <style>{'.iboard-student-workspace .iboard-question-arrival{display:none!important;}'}</style>
      )}
      <div className={collapsed && activity?.id && response ? 'hidden' : ''}>
        <LiveResponseStudentCore {...props} socket={socket} standalone />
      </div>
      {collapsed && activity?.id && response && (
        <button
          type="button"
          onClick={() => {
            if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
            collapseTimerRef.current = null;
            setCollapsed(false);
          }}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:hover:bg-indigo-950/40"
        >
          <span className="min-w-0 truncate text-sm font-black text-slate-800 dark:text-slate-100">
            Answered ✓ · Q{activity.questionNumber || 1}
          </span>
          <span className="shrink-0 rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] font-black leading-none text-white">
            Open
          </span>
        </button>
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
    const expandSoon = () => {
      clearExpand();
      clearCollapse();
      // Keep the panel collapsed long enough for the core attention effect to fire
      // without scrolling the student's writing workspace. Then expand in-place.
      setExpanded(false);
      expandTimerRef.current = setTimeout(() => setExpanded(true), 180);
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
      if (id !== activityIdRef.current) {
        activityIdRef.current = id;
        expandSoon();
        return;
      }
      // Keep the question open after the answer so the student can choose confidence.
      // Once confidence is saved, roll the compact panel up as before.
      if (nextResponse?.confidence) collapseSoon();
    };

    const onActivity = (payload) => noteActivity(payload?.activity, null);
    const onMine = (payload) => noteActivity(payload?.activity, payload?.response);
    const onRealert = (payload) => {
      if (payload?.activity?.id) {
        activityIdRef.current = String(payload.activity.id);
        expandSoon();
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
