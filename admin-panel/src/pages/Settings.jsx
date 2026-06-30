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

  // SMS regex builder / tester (auto card-to-card)
  const [smsSample, setSmsSample] = useState('');
  const [smsKnownAmount, setSmsKnownAmount] = useState('');
  const [smsRegex, setSmsRegex] = useState('');
  const [smsDetected, setSmsDetected] = useState(null);
  const [smsBuilding, setSmsBuilding] = useState(false);
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsTestSample, setSmsTestSample] = useState('');
  const [smsTestResult, setSmsTestResult] = useState(null);
  const [smsTesting, setSmsTesting] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchSmsRegex();
  }, []);

  const fetchSmsRegex = async () => {
    try {
      const res = await api.get('/admin/bot-config');
      setSmsRegex(res.data?.data?.smsBankRegex || '');
    } catch { /* non-fatal */ }
  };

  const handleBuildRegex = async () => {
    if (!smsSample.trim()) { toast.error('Paste a sample SMS first'); return; }
    try {
      setSmsBuilding(true);
      const res = await api.post('/admin/sms/build-regex', {
        sample: smsSample,
        amount: smsKnownAmount === '' ? undefined : Number(smsKnownAmount),
      });
      setSmsRegex(res.data.data.regex);
      setSmsDetected(res.data.data.detectedAmount);
      toast.success(`Detected amount: ${res.data.data.detectedAmount.toLocaleString()} — review & save`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not build regex');
    } finally {
      setSmsBuilding(false);
    }
  };

  const handleSaveRegex = async () => {
    try {
      setSmsSaving(true);
      await api.put('/admin/bot-config', { smsBankRegex: smsRegex });
      toast.success('SMS regex saved');
    } catch (err) {
      toast.error('Failed to save regex');
    } finally {
      setSmsSaving(false);
    }
  };

  const handleTestRegex = async () => {
    if (!smsTestSample.trim()) { toast.error('Paste a test SMS first'); return; }
    try {
      setSmsTesting(true);
      const res = await api.post('/admin/sms/test', { sample: smsTestSample, regex: smsRegex });
      setSmsTestResult(res.data.data);
    } catch (err) {
      toast.error('Test failed');
    } finally {
      setSmsTesting(false);
    }
  };

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

      <div className="max-w-2xl">
        <div className="card space-y-4">
          <h2 className="text-xl font-semibold">SMS Regex / الگوی پیامک بانک</h2>
          <p className="text-sm text-gray-400">
            متن یک پیامک نمونه‌ی بانک را اینجا بچسبان و «ساخت Regex» را بزن. سیستم خودش مبلغ را
            تشخیص می‌دهد و الگو می‌سازد؛ اگر مبلغ را اشتباه گرفت، مبلغ درست را در کادر «مبلغ» وارد
            کن و دوباره بساز. سپس الگو را بررسی و ذخیره کن. (Paste a sample bank SMS, build, review, save.)
          </p>

          <div>
            <label className="label">Sample SMS / متن نمونه پیامک</label>
            <textarea
              className="input min-h-[90px]"
              placeholder="مثال: بانک ملی&#10;مبلغ 350,000 ریال به حساب شما واریز شد..."
              value={smsSample}
              onChange={(e) => setSmsSample(e.target.value)}
            />
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="label">Known amount (optional) / مبلغ دقیق (اختیاری)</label>
              <input
                type="number"
                className="input"
                placeholder="350000"
                value={smsKnownAmount}
                onChange={(e) => setSmsKnownAmount(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-secondary" onClick={handleBuildRegex} disabled={smsBuilding}>
              {smsBuilding ? '...' : 'Build Regex / ساخت'}
            </button>
          </div>

          {smsDetected != null && (
            <p className="text-sm text-green-400">Detected amount: {Number(smsDetected).toLocaleString()}</p>
          )}

          <div>
            <label className="label">Regex (editable) / الگوی نهایی</label>
            <input
              type="text"
              className="input font-mono text-xs"
              value={smsRegex}
              onChange={(e) => setSmsRegex(e.target.value)}
            />
          </div>

          <button type="button" className="btn btn-primary" onClick={handleSaveRegex} disabled={smsSaving}>
            {smsSaving ? 'Saving...' : 'Save Regex / ذخیره الگو'}
          </button>

          <hr className="border-gray-700" />

          <div>
            <label className="label">Test SMS / تست با یک پیامک</label>
            <textarea
              className="input min-h-[70px]"
              placeholder="یک پیامک دیگر برای تست بچسبان..."
              value={smsTestSample}
              onChange={(e) => setSmsTestSample(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleTestRegex} disabled={smsTesting}>
            {smsTesting ? '...' : 'Test / تست'}
          </button>
          {smsTestResult && (
            <p className={`text-sm ${smsTestResult.matched ? 'text-green-400' : 'text-red-400'}`}>
              {smsTestResult.matched
                ? `✅ Extracted: ${Number(smsTestResult.extractedAmount).toLocaleString()}`
                : '❌ No amount extracted — adjust the regex or sample.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
