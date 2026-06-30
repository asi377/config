import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Menu, LogOut } from 'lucide-react';

export default function Layout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const menuItems = [
    { name: 'Dashboard', path: '/', icon: '📊' },
    { name: 'Users', path: '/users', icon: '👥' },
    { name: 'Plans', path: '/plans', icon: '📋' },
    { name: 'Receipts', path: '/receipts', icon: '📄' },
    { name: 'Bot Builder', path: '/bot-builder', icon: '🤖' },
    { name: 'Server Fleet', path: '/server-fleet', icon: '🖥️' },
    { name: 'Finance', path: '/finance', icon: '💰' },
    { name: 'Reseller Plans', path: '/reseller-plans', icon: '🏷️' },
    { name: 'Reseller Applications', path: '/reseller-applications', icon: '🤝' },
    { name: 'Custom Buttons', path: '/custom-buttons', icon: '🔘' },
    { name: 'Settings', path: '/settings', icon: '⚙️' },
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

        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map((item) => (
            <a
              key={item.path}
              href={item.path}
              className="flex items-center gap-3 px-4 py-2 rounded hover:bg-primary-600 transition text-gray-300 hover:text-white"
            >
              <span className="text-xl">{item.icon}</span>
              {sidebarOpen && <span>{item.name}</span>}
            </a>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2 rounded hover:bg-red-600 transition text-gray-300 hover:text-white"
          >
            <LogOut size={20} />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-gray-900 border-b border-gray-800 px-8 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Admin Panel</h2>
            <div className="text-sm text-gray-400">{admin?.email}</div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { Outlet } from 'react-router-dom';
