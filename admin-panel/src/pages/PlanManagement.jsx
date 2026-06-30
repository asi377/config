import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';

export default function PlanManagement() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ title: '', basePrice: '', baseVolumeGB: '', durationDays: '' });

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/plans');
      setPlans(res.data.data.plans);
    } catch (err) {
      toast.error('Failed to load plans');
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePlan = async () => {
    if (!formData.title || !formData.basePrice) return;
    try {
      await api.post('/admin/plans', {
        ...formData,
        basePrice: parseFloat(formData.basePrice),
        baseVolumeGB: parseFloat(formData.baseVolumeGB),
        durationDays: parseInt(formData.durationDays),
        type: 'normal',
      });
      toast.success('Plan created');
      setShowModal(false);
      setFormData({ title: '', basePrice: '', baseVolumeGB: '', durationDays: '' });
      fetchPlans();
    } catch (err) {
      toast.error('Failed to create plan');
    }
  };

  const handleDeletePlan = async (planId) => {
    if (!confirm('Archive this plan?')) return;
    try {
      await api.delete(`/admin/plans/${planId}`);
      toast.success('Plan archived');
      fetchPlans();
    } catch (err) {
      toast.error('Failed to archive plan');
    }
  };

  if (loading && plans.length === 0) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Plan Management</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary">+ New Plan</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map((plan) => (
          <div key={plan._id} className="card">
            <h3 className="text-lg font-bold mb-2">{plan.title}</h3>
            <div className="text-sm text-gray-400 space-y-1 mb-4">
              <p>Price: {plan.basePrice} IRR</p>
              <p>Volume: {plan.baseVolumeGB}GB</p>
              <p>Duration: {plan.durationDays} days</p>
            </div>
            <button
              onClick={() => handleDeletePlan(plan._id)}
              className="btn-danger w-full text-sm"
            >
              Archive
            </button>
          </div>
        ))}
      </div>

      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <h2 className="text-xl font-bold mb-4">Create New Plan</h2>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Plan Title"
            className="input mb-3"
          />
          <input
            type="number"
            value={formData.basePrice}
            onChange={(e) => setFormData({ ...formData, basePrice: e.target.value })}
            placeholder="Base Price (IRR)"
            className="input mb-3"
          />
          <input
            type="number"
            value={formData.baseVolumeGB}
            onChange={(e) => setFormData({ ...formData, baseVolumeGB: e.target.value })}
            placeholder="Volume (GB)"
            className="input mb-3"
          />
          <input
            type="number"
            value={formData.durationDays}
            onChange={(e) => setFormData({ ...formData, durationDays: e.target.value })}
            placeholder="Duration (days)"
            className="input mb-4"
          />
          <div className="flex gap-2">
            <button onClick={handleCreatePlan} className="btn-primary flex-1">Create</button>
            <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
