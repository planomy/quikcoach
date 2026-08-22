import { useEffect, useRef, useState } from 'react';
import LiveResponseStudentCore from './LiveResponseStudentCore.jsx';
import './studentWorkspace.css';

function isEmbeddedStudentWorkspace(props) {
  if (props?.standalone) return false;
  if (typeof window === 'undefined') return false;
  return window.location.pathname === '/student';
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
    const noteActivity = (activity, response) => {
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
      if (response) collapseSoon();
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
  if (!isEmbeddedStudentWorkspace(props)) {
    return <LiveResponseStudentCore {...props} />;
  }
  return <DockedPulse {...props} />;
}
