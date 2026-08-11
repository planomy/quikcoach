import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import StudentView from './pages/StudentView.jsx';
import Whiteboard from './pages/Whiteboard.jsx';
import PulseStudent from './pages/PulseStudent.jsx';
import PulseTeacher from './pages/PulseTeacher.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/teacher" element={<TeacherDashboard />} />
      <Route path="/student" element={<StudentView />} />
      <Route path="/pulse/teacher" element={<PulseTeacher />} />
      <Route path="/pulse" element={<PulseStudent />} />
      <Route path="/iboard" element={<Whiteboard />} />
      <Route path="/board" element={<Whiteboard />} />
      <Route path="/whiteboard" element={<Navigate to="/iboard" replace />} />
    </Routes>
  );
}
