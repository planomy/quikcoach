import { useEffect, useRef, useState } from 'react';
import LiveResponseStudentCore from './LiveResponseStudentCore.jsx';
import './studentWorkspace.css';

function UnifiedInboxPulse({ socket, ...props }) {
  const [collapsed, setCollapsed] = useState(false);
  const activityIdRef = useRef('');

  useEffect(() => {
    const onActivity = (payload) => {
      const next = payload?.activity || null;
      const id = next?.id ? String(next.id) : '';
      if (!id) {
        activityIdRef.current = '';
        setCollapsed(false);
        return;
      }
      if (id !== activityIdRef.current) {
        activityIdRef.current = id;
        const verbal = next?.type === 'short' && next?.prompt === 'Verbal question';
        setCollapsed(verbal ? true : false);
      }
    };
    const onMine = (payload) => {
      const next = payload?.activity || null;
      const nextResponse = payload?.response || null;
      if (next?.id) activityIdRef.current = String(next.id);
      if (nextResponse) setCollapsed(true);
      else if (next?.id) {
        const verbal = next?.type === 'short' && next?.prompt === 'Verbal question';
        setCollapsed(verbal ? true : false);
      }
    };
    const onRealert = (payload) => {
      if (!payload?.activity?.id) return;
      activityIdRef.current = String(payload.activity.id);
      const verbal = payload.activity?.type === 'short' && payload.activity?.prompt === 'Verbal question';
      setCollapsed(verbal ? true : false);
    };

    socket.on('live:activity', onActivity);
    socket.on('live:student', onMine);
    socket.on('live:realert', onRealert);
    return () => {
      socket.off('live:activity', onActivity);
      socket.off('live:student', onMine);
      socket.off('live:realert', onRealert);
    };
  }, [socket]);

  return (
    <LiveResponseStudentCore
      {...props}
      socket={socket}
      standalone
      collapsed={collapsed}
      onCollapse={() => setCollapsed(true)}
      onExpand={() => setCollapsed(false)}
    />
  );
}

export default function LiveResponseStudent(props) {
  return <UnifiedInboxPulse {...props} />;
}
