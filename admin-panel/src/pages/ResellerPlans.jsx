import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';

const EMPTY_FORM = {
  name: '',
  displayName: '',
  maxActiveAccounts: '',
  discountPercent: '',
  requiresApproval: true,
  applicationFee: '',
  isActive: true,
  sortOrder: '',
};

export default function ResellerPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/reseller-plans');
      setPlans(res.data.data);
    } catch (err) {
      toast.error('Failed to load reseller plans');
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (plan) => {
    setEditingId(plan._id);
    setFormData({
      name: plan.name,
      displayName: plan.displayName,
      maxActiveAccounts: plan.maxActiveAccounts === null || plan.maxActiveAccounts === undefined ? '' : plan.maxActiveAccounts,
      discountPercent: plan.discountPercent,
      requiresApproval: plan.requiresApproval,
      applicationFee: plan.applicationFee,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    });
    setShowModal(true);
  };

  const buildPayload = () => ({
    name: formData.name,
    displayName: formData.displayName,
    maxActiveAccounts: formData.maxActiveAccounts === '' ? null : parseInt(formData.maxActiveAccounts),
    discountPercent: parseFloat(formData.discountPercent),
    requiresApproval: !!formData.requiresApproval,
    applicationFee: formData.applicationFee === '' ? 0 : parseFloat(formData.applicationFee),
    isActive: !!formData.isActive,
    sortOrder: formData.sortOrder === '' ? 0 : parseInt(formData.sortOrder),
  });

  const handleSave = async () => {
    if (!formData.name || !formData.displayName || formData.discountPercent === '') {
      toast.error('Name, display name and discount % are required');
      return;
    }
    try {
      if (editingId) {
        await api.put(`/admin/reseller-plans/${editingId}`, buildPayload());
        toast.success('Reseller plan updated');
      } else {
        await api.post('/admin/reseller-plans', buildPayload());
        toast.success('Reseller plan created');
      }
      setShowModal(false);
      setFormData(EMPTY_FORM);
      setEditingId(null);
      fetchPlans();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save reseller plan');
    }
  };

  const handleDeactivate = async (planId) => {
    if (!confirm('Deactivate this reseller plan?')) return;
    try {
      await api.delete(`/admin/reseller-plans/${planId}`);
      toast.success('Reseller plan deactivated');
      fetchPlans();
    } catch (err) {
      toast.error('Failed to deactivate reseller plan');
    }
  };

  if (loading && plans.length === 0) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Reseller Plans</h1>
        <button onClick={openCreateModal} className="btn-primary">+ New Tier</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Display Name</th>
              <th className="py-2 pr-4">Cap</th>
              <th className="py-2 pr-4">Discount</th>
              <th className="py-2 pr-4">Approval</th>
              <th className="py-2 pr-4">Fee</th>
              <th className="py-2 pr-4">Active</th>
              <th className="py-2 pr-4">Order</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan._id} className="border-b border-gray-800/50">
                <td className="py-2 pr-4">{plan.name}</td>
                <td className="py-2 pr-4">{plan.displayName}</td>
                <td className="py-2 pr-4">{plan.maxActiveAccounts === null ? 'Unlimited' : plan.maxActiveAccounts}</td>
                <td className="py-2 pr-4">{plan.discountPercent}%</td>
                <td className="py-2 pr-4">{plan.requiresApproval ? 'Required' : 'Auto'}</td>
                <td className="py-2 pr-4">{plan.applicationFee || 0}</td>
                <td className="py-2 pr-4">{plan.isActive ? '✅' : '❌'}</td>
                <td className="py-2 pr-4">{plan.sortOrder}</td>
                <td className="py-2 pr-4 space-x-2">
                  <button onClick={() => openEditModal(plan)} className="btn-secondary text-xs">Edit</button>
                  <button onClick={() => handleDeactivate(plan._id)} className="btn-danger text-xs">Deactivate</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <h2 className="text-xl font-bold mb-4">{editingId ? 'Edit Reseller Tier' : 'Create Reseller Tier'}</h2>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Internal name (e.g. tier1)"
            className="input mb-3"
          />
          <input
            type="text"
            value={formData.displayName}
            onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
            placeholder="Display Name"
            className="input mb-3"
          />
          <input
            type="number"
            value={formData.maxActiveAccounts}
            onChange={(e) => setFormData({ ...formData, maxActiveAccounts: e.target.value })}
            placeholder="Max active accounts (blank = unlimited)"
            className="input mb-3"
          />
          <input
            type="number"
            value={formData.discountPercent}
            onChange={(e) => setFormData({ ...formData, discountPercent: e.target.value })}
            placeholder="Discount %"
            className="input mb-3"
          />
          <input
            type="number"
            value={formData.applicationFee}
            onChange={(e) => setFormData({ ...formData, applicationFee: e.target.value })}
            placeholder="Application Fee"
            className="input mb-3"
          />
          <input
            type="number"
            value={formData.sortOrder}
            onChange={(e) => setFormData({ ...formData, sortOrder: e.target.value })}
            placeholder="Sort Order"
            className="input mb-3"
          />
          <label className="flex items-center gap-2 mb-3 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={!!formData.requiresApproval}
              onChange={(e) => setFormData({ ...formData, requiresApproval: e.target.checked })}
            />
            Requires admin approval
          </label>
          <label className="flex items-center gap-2 mb-4 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={!!formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
            />
            Active
          </label>
          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-primary flex-1">{editingId ? 'Save' : 'Create'}</button>
            <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
