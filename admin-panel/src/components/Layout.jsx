import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Bot,
  Server,
  Wallet,
  LogOut,
  Shield,
} from 'lucide-react';

const navItems = [
  { to: '/bot-builder', icon: Bot, label: 'Bot Builder' },
  { to: '/server-fleet', icon: Server, label: 'Server Fleet' },
  { to: '/finance', icon: Wallet, label: 'Finance' },
];

export default function Layout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-950">
      <aside className="w-64 flex-shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col">
        <div className="flex items-center gap-3 px-5 h-16 border-b border-gray-800">
          <Shield className="w-6 h-6 text-primary-400" />
          <span className="font-bold text-lg">Admin Panel</span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-600/20 text-primary-400 border border-primary-600/30'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-800">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-xs font-bold">
              {admin?.displayName?.[0] || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{admin?.displayName || 'Admin'}</p>
              <p className="text-xs text-gray-500 truncate">{admin?.email || ''}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 w-full mt-1 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
