import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import PlanManagement from './pages/PlanManagement';
import ReceiptManagement from './pages/ReceiptManagement';
import BotBuilder from './pages/BotBuilder';
import ServerFleet from './pages/ServerFleet';
import Finance from './pages/Finance';
import Settings from './pages/Settings';
import ResellerPlans from './pages/ResellerPlans';
import ResellerApplications from './pages/ResellerApplications';
import CustomButtons from './pages/CustomButtons';

function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();
  if (loading) return <div className="text-center py-8">Loading...</div>;
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
        <Route index element={<Dashboard />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="plans" element={<PlanManagement />} />
        <Route path="receipts" element={<ReceiptManagement />} />
        <Route path="bot-builder" element={<BotBuilder />} />
        <Route path="server-fleet" element={<ServerFleet />} />
        <Route path="finance" element={<Finance />} />
        <Route path="reseller-plans" element={<ResellerPlans />} />
        <Route path="reseller-applications" element={<ResellerApplications />} />
        <Route path="custom-buttons" element={<CustomButtons />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
