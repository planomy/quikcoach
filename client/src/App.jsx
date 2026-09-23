import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import StudentView from './pages/StudentView.jsx';
import Whiteboard from './pages/Whiteboard.jsx';
import TeacherAnnotationController from './components/TeacherAnnotationController.jsx';
import NoteSendStatusControl from './components/NoteSendStatusControl.jsx';
import TeacherPresenterDock from './components/TeacherPresenterDock.jsx';
import TeacherLiveQuestionIndicators from './components/TeacherLiveQuestionIndicators.jsx';
import TeacherCardEditController from './components/TeacherCardEditController.jsx';
import UiInteractionController from './components/UiInteractionController.jsx';
import ConnectionStatusController from './components/ConnectionStatusController.jsx';
import ClassResetController from './components/ClassResetController.jsx';
import ConfirmDialogHost from './components/ConfirmDialogHost.jsx';
import './styles/teacherCleanUi.css';
import './styles/studentCleanUi.css';
import './styles/studentLiveResponsePolish.css';
import './styles/toolSurfaces.css';

function TeacherConsole() {
  return (
    <>
      <TeacherDashboard />
      <TeacherAnnotationController />
      <NoteSendStatusControl />
      <TeacherPresenterDock />
      <TeacherLiveQuestionIndicators />
      <TeacherCardEditController />
      <UiInteractionController />
      <ConnectionStatusController />
      <ClassResetController role="teacher" />
    </>
  );
}

function StudentConsole() {
  return (
    <>
      <StudentView />
      <UiInteractionController />
      <ConnectionStatusController />
      <ClassResetController role="student" />
    </>
  );
}

function RedirectWithCode({ to }) {
  const [params] = useSearchParams();
  const code = String(params.get('code') || '').replace(/\D/g, '').slice(0, 4);
  return <Navigate to={code.length === 4 ? `${to}?code=${code}` : to} replace />;
}

export default function App() {
  return (
    <>
      <ConfirmDialogHost />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/teacher" element={<TeacherConsole />} />
        <Route path="/student" element={<StudentConsole />} />
        <Route path="/pulse/teacher" element={<RedirectWithCode to="/teacher" />} />
        <Route path="/pulse" element={<RedirectWithCode to="/student" />} />
        <Route path="/iboard" element={<Whiteboard />} />
        <Route path="/board" element={<Whiteboard />} />
        <Route path="/whiteboard" element={<Navigate to="/iboard" replace />} />
      </Routes>
    </>
  );
}
