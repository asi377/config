import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import toast from 'react-hot-toast';

export default function Dashboard() {
  const { admin } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await api.get('/admin/dashboard');
        setData(res.data.data);
      } catch (err) {
        toast.error('Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (loading) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-gray-400 text-sm">Total Users</div>
          <div className="text-3xl font-bold text-primary-500">{data?.totalUsers || 0}</div>
        </div>
        <div className="card">
          <div className="text-gray-400 text-sm">Active Subscriptions</div>
          <div className="text-3xl font-bold text-primary-500">{data?.activeSubscriptions || 0}</div>
        </div>
        <div className="card">
          <div className="text-gray-400 text-sm">Pending Receipts</div>
          <div className="text-3xl font-bold text-primary-500">{data?.pendingReceipts || 0}</div>
        </div>
        <div className="card">
          <div className="text-gray-400 text-sm">Daily Revenue</div>
          <div className="text-3xl font-bold text-primary-500">{data?.dailyRevenue || 0} IRR</div>
        </div>
      </div>
    </div>
  );
}
