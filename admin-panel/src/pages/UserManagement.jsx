import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [walletAmount, setWalletAmount] = useState('');

  useEffect(() => {
    fetchUsers();
  }, [page]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/admin/users?page=${page}&limit=20`);
      setUsers(res.data.data.users);
    } catch (err) {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleBanUser = async (userId) => {
    if (!confirm('Ban this user?')) return;
    try {
      await api.post(`/admin/users/${userId}/ban`);
      toast.success('User banned');
      fetchUsers();
    } catch (err) {
      toast.error('Failed to ban user');
    }
  };

  const handleWalletAdjust = async () => {
    if (!selectedUser || !walletAmount) return;
    try {
      await api.post(`/admin/users/${selectedUser._id}/wallet`, {
        amount: parseFloat(walletAmount),
        description: 'Admin adjustment',
      });
      toast.success('Wallet adjusted');
      setShowModal(false);
      setWalletAmount('');
      fetchUsers();
    } catch (err) {
      toast.error('Failed to adjust wallet');
    }
  };

  if (loading && users.length === 0) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">User Management</h1>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-3 px-4 text-gray-300">Telegram ID</th>
              <th className="text-left py-3 px-4 text-gray-300">Balance</th>
              <th className="text-left py-3 px-4 text-gray-300">Role</th>
              <th className="text-left py-3 px-4 text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user._id} className="border-b border-gray-800 hover:bg-gray-800 transition">
                <td className="py-3 px-4">{user.telegramId}</td>
                <td className="py-3 px-4">{user.walletBalance} IRR</td>
                <td className="py-3 px-4">{user.role}</td>
                <td className="py-3 px-4 space-x-2">
                  <button
                    onClick={() => {
                      setSelectedUser(user);
                      setShowModal(true);
                    }}
                    className="btn-secondary text-sm"
                  >
                    Adjust
                  </button>
                  <button
                    onClick={() => handleBanUser(user._id)}
                    className="btn-danger text-sm"
                  >
                    Ban
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => setPage(Math.max(1, page - 1))} className="btn-secondary">← Prev</button>
      <button onClick={() => setPage(page + 1)} className="btn-secondary">Next →</button>

      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <h2 className="text-xl font-bold mb-4">Adjust Wallet</h2>
          <input
            type="number"
            value={walletAmount}
            onChange={(e) => setWalletAmount(e.target.value)}
            placeholder="Amount (IRR)"
            className="input mb-4"
          />
          <div className="flex gap-2">
            <button onClick={handleWalletAdjust} className="btn-primary flex-1">Adjust</button>
            <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
