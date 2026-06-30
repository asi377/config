import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'none'];

export default function ResellerApplications() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('pending');

  useEffect(() => {
    fetchApplications();
  }, [status]);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/reseller-applications', { params: { status } });
      setApplications(res.data.data);
    } catch (err) {
      toast.error('Failed to load reseller applications');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (userId) => {
    if (!confirm('Approve this reseller application?')) return;
    try {
      await api.post(`/admin/reseller-applications/${userId}/approve`);
      toast.success('Application approved');
      fetchApplications();
    } catch (err) {
      toast.error('Failed to approve application');
    }
  };

  const handleReject = async (userId) => {
    if (!confirm('Reject this reseller application?')) return;
    try {
      await api.post(`/admin/reseller-applications/${userId}/reject`);
      toast.success('Application rejected');
      fetchApplications();
    } catch (err) {
      toast.error('Failed to reject application');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Reseller Applications</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="input w-48"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading && applications.length === 0 ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800">
                <th className="py-2 pr-4">Telegram ID</th>
                <th className="py-2 pr-4">Requested Tier</th>
                <th className="py-2 pr-4">Application Fee</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Wallet Balance</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {applications.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500">No applications found</td>
                </tr>
              )}
              {applications.map((user) => (
                <tr key={user._id} className="border-b border-gray-800/50">
                  <td className="py-2 pr-4">{user.telegramId}</td>
                  <td className="py-2 pr-4">{user.currentResellerPlanId?.displayName || '—'}</td>
                  <td className="py-2 pr-4">{user.currentResellerPlanId?.applicationFee || 0}</td>
                  <td className="py-2 pr-4">{user.resellerApplicationStatus}</td>
                  <td className="py-2 pr-4">{user.walletBalance}</td>
                  <td className="py-2 pr-4 space-x-2">
                    {user.resellerApplicationStatus === 'pending' && (
                      <>
                        <button onClick={() => handleApprove(user._id)} className="btn-primary text-xs">Approve</button>
                        <button onClick={() => handleReject(user._id)} className="btn-danger text-xs">Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
