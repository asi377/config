import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';

export default function ReceiptManagement() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');

  useEffect(() => {
    fetchReceipts();
  }, [filter]);

  const fetchReceipts = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/admin/receipts?status=${filter}`);
      setReceipts(res.data.data);
    } catch (err) {
      toast.error('Failed to load receipts');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (receiptId) => {
    try {
      await api.post(`/admin/receipts/${receiptId}/approve`);
      toast.success('Receipt approved');
      fetchReceipts();
    } catch (err) {
      toast.error('Failed to approve receipt');
    }
  };

  const handleReject = async (receiptId) => {
    try {
      await api.post(`/admin/receipts/${receiptId}/reject`);
      toast.success('Receipt rejected');
      fetchReceipts();
    } catch (err) {
      toast.error('Failed to reject receipt');
    }
  };

  if (loading) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Receipt Management</h1>
      <div className="flex gap-2">
        {['pending', 'approved', 'rejected'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-3 px-4 text-gray-300">User</th>
              <th className="text-left py-3 px-4 text-gray-300">Amount</th>
              <th className="text-left py-3 px-4 text-gray-300">Status</th>
              <th className="text-left py-3 px-4 text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt._id} className="border-b border-gray-800">
                <td className="py-3 px-4">{receipt.userId?.telegramId}</td>
                <td className="py-3 px-4">{receipt.amount} IRR</td>
                <td className="py-3 px-4">{receipt.status}</td>
                <td className="py-3 px-4 space-x-2">
                  {receipt.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleApprove(receipt._id)}
                        className="btn-primary text-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(receipt._id)}
                        className="btn-danger text-sm"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
