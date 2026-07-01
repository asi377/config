import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, NavLink, Outlet } from 'react-router-dom';
import { Menu, LogOut, Languages } from 'lucide-react';
import { useI18n } from '../i18n';

export default function Layout() {
  const { admin, logout } = useAuth();
  const { t, lang, toggle } = useI18n();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // `end` on the index route so it isn't always-active.
  const menuItems = [
    { key: 'dashboard', path: '/', icon: '📊', end: true },
    { key: 'users', path: '/users', icon: '👥' },
    { key: 'plans', path: '/plans', icon: '📋' },
    { key: 'receipts', path: '/receipts', icon: '📄' },
    { key: 'botBuilder', path: '/bot-builder', icon: '🤖' },
    { key: 'serverFleet', path: '/server-fleet', icon: '🖥️' },
    { key: 'finance', path: '/finance', icon: '💰' },
    { key: 'resellerPlans', path: '/reseller-plans', icon: '🏷️' },
    { key: 'resellerApplications', path: '/reseller-applications', icon: '🤝' },
    { key: 'customButtons', path: '/custom-buttons', icon: '🔘' },
    { key: 'settings', path: '/settings', icon: '⚙️' },
  ];

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-gray-900 border-r border-gray-800 transition-all duration-300 flex flex-col`}>
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          {sidebarOpen && <h1 className="font-bold text-lg">HORNET</h1>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-gray-800 rounded">
            <Menu size={20} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-auto">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 rounded transition ${
                  isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-primary-600 hover:text-white'
                }`
              }
            >
              <span className="text-xl">{item.icon}</span>
              {sidebarOpen && <span>{t(`nav.${item.key}`)}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2 rounded hover:bg-red-600 transition text-gray-300 hover:text-white"
          >
            <LogOut size={20} />
            {sidebarOpen && <span>{t('common.logout')}</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-gray-900 border-b border-gray-800 px-8 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t('header.title')}</h2>
            <div className="flex items-center gap-4">
              <button
                onClick={toggle}
                title={t('common.language')}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 transition"
              >
                <Languages size={16} />
                <span>{lang === 'fa' ? 'EN' : 'فا'}</span>
              </button>
              <div className="text-sm text-gray-400">{admin?.email}</div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
