import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';

const FORCE_SUB_KEYS = ['forceSubscribe.enabled', 'forceSubscribe.channels'];
const emptyChannel = () => ({ id: '', inviteLink: '', title: '' });

const AUTO_APPROVE_KEYS = [
  'payment.autoApprove.enabled',
  'payment.autoApprove.toleranceAmount',
  'payment.autoApprove.ceilingAmount',
  'payment.autoApprove.maxFraudScore',
  'payment.cardNumber',
];

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);

  const [fsEnabled, setFsEnabled] = useState(false);
  const [fsChannels, setFsChannels] = useState([]);
  const [fsSaving, setFsSaving] = useState(false);

  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [toleranceAmount, setToleranceAmount] = useState(0);
  const [ceilingAmount, setCeilingAmount] = useState(2000000);
  const [maxFraudScore, setMaxFraudScore] = useState(40);
  const [cardNumber, setCardNumber] = useState('5022-2910-XXXX-XXXX');
  const [autoApproveSaving, setAutoApproveSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/settings');
      const map = res.data.data.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});
      setSettings(map);
      setFsEnabled(Boolean(map['forceSubscribe.enabled']));
      const channels = Array.isArray(map['forceSubscribe.channels']) ? map['forceSubscribe.channels'] : [];
      setFsChannels(channels.length ? channels : []);

      setAutoApproveEnabled(Boolean(map['payment.autoApprove.enabled']));
      setToleranceAmount(
        map['payment.autoApprove.toleranceAmount'] !== undefined ? map['payment.autoApprove.toleranceAmount'] : 0,
      );
      setCeilingAmount(
        map['payment.autoApprove.ceilingAmount'] !== undefined ? map['payment.autoApprove.ceilingAmount'] : 2000000,
      );
      setMaxFraudScore(
        map['payment.autoApprove.maxFraudScore'] !== undefined ? map['payment.autoApprove.maxFraudScore'] : 40,
      );
      setCardNumber(map['payment.cardNumber'] || '5022-2910-XXXX-XXXX');
    } catch (err) {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSetting = async (key, value) => {
    try {
      await api.put(`/admin/settings/${key}`, { value });
      toast.success('Setting saved');
    } catch (err) {
      toast.error('Failed to save setting');
    }
  };

  const handleToggleForceSubscribe = async (e) => {
    const value = e.target.checked;
    setFsEnabled(value);
    try {
      await api.put('/admin/settings/forceSubscribe.enabled', { value });
      toast.success('عضویت اجباری به‌روزرسانی شد / Force subscribe updated');
    } catch (err) {
      setFsEnabled(!value);
      toast.error('Failed to update force subscribe');
    }
  };

  const handleChannelChange = (idx, field, value) => {
    setFsChannels((prev) => prev.map((ch, i) => (i === idx ? { ...ch, [field]: value } : ch)));
  };

  const handleAddChannel = () => {
    setFsChannels((prev) => [...prev, emptyChannel()]);
  };

  const handleRemoveChannel = (idx) => {
    setFsChannels((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveChannels = async () => {
    try {
      setFsSaving(true);
      await api.put('/admin/settings/forceSubscribe.channels', { value: fsChannels });
      toast.success('Channels saved');
    } catch (err) {
      toast.error('Failed to save channels');
    } finally {
      setFsSaving(false);
    }
  };

  const handleToggleAutoApprove = async (e) => {
    const value = e.target.checked;
    setAutoApproveEnabled(value);
    try {
      await api.put('/admin/settings/payment.autoApprove.enabled', { value });
      toast.success('Auto-approve setting updated');
    } catch (err) {
      setAutoApproveEnabled(!value);
      toast.error('Failed to update auto-approve setting');
    }
  };

  const handleSaveAutoApproveFields = async () => {
    try {
      setAutoApproveSaving(true);
      await Promise.all([
        api.put('/admin/settings/payment.autoApprove.toleranceAmount', { value: Number(toleranceAmount) }),
        api.put('/admin/settings/payment.autoApprove.ceilingAmount', { value: Number(ceilingAmount) }),
        api.put('/admin/settings/payment.autoApprove.maxFraudScore', { value: Number(maxFraudScore) }),
        api.put('/admin/settings/payment.cardNumber', { value: cardNumber }),
      ]);
      toast.success('Payment settings saved');
    } catch (err) {
      toast.error('Failed to save payment settings');
    } finally {
      setAutoApproveSaving(false);
    }
  };

  if (loading) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <div className="max-w-2xl">
        <div className="card space-y-6">
          {Object.entries(settings)
            .filter(([key]) => !FORCE_SUB_KEYS.includes(key) && !AUTO_APPROVE_KEYS.includes(key))
            .map(([key, value]) => (
              <div key={key}>
                <label className="label">{key}</label>
                <input
                  type="text"
                  defaultValue={value}
                  onBlur={(e) => handleSaveSetting(key, e.target.value)}
                  className="input"
                />
              </div>
            ))}
        </div>
      </div>

      <div className="max-w-2xl">
        <div className="card space-y-4">
          <h2 className="text-xl font-semibold">Force Subscribe / عضویت اجباری</h2>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={fsEnabled} onChange={handleToggleForceSubscribe} />
            <span>Require users to join channel(s) before using the bot</span>
          </label>

          <div className="space-y-3">
            {fsChannels.map((ch, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center border-b pb-3">
                <input
                  type="text"
                  className="input"
                  placeholder="Channel ID (e.g. @mychannel or -100123...)"
                  value={ch.id}
                  onChange={(e) => handleChannelChange(idx, 'id', e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Title"
                  value={ch.title}
                  onChange={(e) => handleChannelChange(idx, 'title', e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Invite link (https://t.me/...)"
                  value={ch.inviteLink}
                  onChange={(e) => handleChannelChange(idx, 'inviteLink', e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleRemoveChannel(idx)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={handleAddChannel}>
              + Add Channel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSaveChannels} disabled={fsSaving}>
              {fsSaving ? 'Saving...' : 'Save Channels'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl">
        <div className="card space-y-4">
          <h2 className="text-xl font-semibold">Payment Auto-Approve / تأیید خودکار پرداخت</h2>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoApproveEnabled} onChange={handleToggleAutoApprove} />
            <span>Automatically approve receipts matched via SMS within tolerance/fraud limits</span>
          </label>

          <div>
            <label className="label">Tolerance Amount (extra IRR allowed above expected amount)</label>
            <input
              type="number"
              className="input"
              value={toleranceAmount}
              onChange={(e) => setToleranceAmount(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Ceiling Amount (max IRR eligible for auto-approve)</label>
            <input
              type="number"
              className="input"
              value={ceilingAmount}
              onChange={(e) => setCeilingAmount(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Max Fraud Score (0-100, lower is stricter)</label>
            <input
              type="number"
              className="input"
              value={maxFraudScore}
              onChange={(e) => setMaxFraudScore(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Card Number (shown to users for card-to-card payment)</label>
            <input
              type="text"
              className="input"
              placeholder="5022-2910-XXXX-XXXX"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveAutoApproveFields}
            disabled={autoApproveSaving}
          >
            {autoApproveSaving ? 'Saving...' : 'Save Payment Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
