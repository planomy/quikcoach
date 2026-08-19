import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import StudentView from './pages/StudentView.jsx';
import Whiteboard from './pages/Whiteboard.jsx';
import PulseStudent from './pages/PulseStudent.jsx';
import PulseTeacher from './pages/PulseTeacher.jsx';
import StudentFormattingControl from './components/StudentFormattingControl.jsx';
import TeacherAnnotationController from './components/TeacherAnnotationController.jsx';
import NoteSendStatusControl from './components/NoteSendStatusControl.jsx';

function TeacherConsole() {
  return (
    <>
      <TeacherDashboard />
      <StudentFormattingControl />
      <TeacherAnnotationController />
      <NoteSendStatusControl />
    </>
  );
}

function StudentConsole() {
  return <StudentView />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/teacher" element={<TeacherConsole />} />
      <Route path="/student" element={<StudentConsole />} />
      <Route path="/pulse/teacher" element={<PulseTeacher />} />
      <Route path="/pulse" element={<PulseStudent />} />
      <Route path="/iboard" element={<Whiteboard />} />
      <Route path="/board" element={<Whiteboard />} />
      <Route path="/whiteboard" element={<Navigate to="/iboard" replace />} />
    </Routes>
  );
}
