import { Navigate } from 'react-router-dom';

/** Home sends students straight to join — no Teacher / Student choice. */
export default function Landing() {
  return <Navigate to="/student" replace />;
}
