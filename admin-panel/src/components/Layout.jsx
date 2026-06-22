import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, Server, DollarSign, Bot, Users, LogOut, Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';

const NAV = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'داشبورد' },
    { to: '/servers', icon: Server, label: 'سرورها' },
    { to: '/finance', icon: DollarSign, label: 'مالی' },
    { to: '/bot-builder', icon: Bot, label: 'بات' },
    { to: '/users', icon: Users, label: 'کاربران' },
];

export default function Layout() {
    const { logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => { logout(); navigate('/login'); };

    return (
        <div className="flex h-screen overflow-hidden bg-gray-950">
            {/* Sidebar */}
            <aside className="w-56 flex-shrink-0 flex flex-col bg-gray-900 border-l border-gray-800">
                {/* Logo */}
                <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-800">
                    <Zap className="text-brand-500" size={22} />
                    <span className="text-lg font-bold text-white">HORNET</span>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {NAV.map(({ to, icon: Icon, label }) => (
                        <NavLink
                            key={to} to={to}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors
                 ${isActive
                                    ? 'bg-brand-600 text-white font-medium'
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`
                            }
                        >
                            <Icon size={18} />
                            {label}
                        </NavLink>
                    ))}
                </nav>

                {/* Logout */}
                <div className="px-3 py-4 border-t border-gray-800">
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-red-900/30 hover:text-red-400 transition-colors"
                    >
                        <LogOut size={18} />
                        خروج
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-y-auto p-6">
                <Outlet />
            </main>
        </div>
    );
}
