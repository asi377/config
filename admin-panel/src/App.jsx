import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Layout from './components/Layout';
import BotBuilder from './pages/BotBuilder';
import ServerFleet from './pages/ServerFleet';
import Finance from './pages/Finance';

function ProtectedRoute({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/bot-builder" replace />} />
        <Route path="bot-builder" element={<BotBuilder />} />
        <Route path="server-fleet" element={<ServerFleet />} />
        <Route path="finance" element={<Finance />} />
      </Route>
    </Routes>
  );
}
