import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ServersPage from './pages/ServersPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import BotBuilderPage from './pages/BotBuilderPage.jsx';
import UsersPage from './pages/UsersPage.jsx';

function PrivateRoute({ children }) {
    const { apiKey } = useAuth();
    return apiKey ? children : <Navigate to="/login" replace />;
}

export default function App() {
    return (
        <AuthProvider>
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="servers" element={<ServersPage />} />
                    <Route path="finance" element={<FinancePage />} />
                    <Route path="bot-builder" element={<BotBuilderPage />} />
                    <Route path="users" element={<UsersPage />} />
                </Route>
            </Routes>
        </AuthProvider>
    );
}
