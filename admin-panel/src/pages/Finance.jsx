import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Wallet, Key, TestTube, Save, Eye, EyeOff, Check, X, Play } from 'lucide-react';
import api from '../api/client';

const SMS_SAMPLES = [
  { label: 'Card transfer (IRR)', text: 'انتقال:۵,۰۰۰,۰۰۰+ از بانک ملی ایران' },
  { label: 'Transfer with ريال', text: 'مبلغ: ۲۵۰,۰۰۰ ریال واریز شد' },
  { label: 'Simple number', text: '1000000 ریال واریز از بانک' },
  { label: 'Custom text', text: '' },
];

const BANK_PATTERNS = [
  /انتقال:([\d,]+)\+/,
  /انتقالي:([\d,]+)\+/,
  /مبلغ:?\s*([\d,]+)\s*ریال/,
  /مبلغ:?\s*([\d,]+)/,
  /(\d{4,})\s*ریال/,
];

function extractFallback(smsText) {
  if (!smsText || typeof smsText !== 'string') return null;
  for (const pattern of BANK_PATTERNS) {
    const match = smsText.match(pattern);
    if (match) {
      const cleaned = match[1].replace(/,/g, '').trim();
      const amount = parseInt(cleaned, 10);
      if (!isNaN(amount) && amount > 0) return amount;
    }
  }
  return null;
}

function RegexTester() {
  const [regexStr, setRegexStr] = useState('');
  const [customSms, setCustomSms] = useState('');
  const [results, setResults] = useState(null);

  const testRegex = () => {
    const tests = [];
    const smsTexts = SMS_SAMPLES.map((s) => s.text);
    if (customSms.trim()) smsTexts.push(customSms.trim());

    for (const text of smsTexts) {
      let extracted = null;
      if (regexStr) {
        try {
          const regex = new RegExp(regexStr);
          const match = text.match(regex);
          if (match && match[1]) {
            const cleaned = match[1].replace(/,/g, '').trim();
            extracted = parseInt(cleaned, 10);
            if (isNaN(extracted) || extracted <= 0) extracted = null;
          }
        } catch {
          extracted = 'Invalid regex';
        }
      }
      const fallback = extractFallback(text);
      tests.push({
        text: text.length > 60 ? text.slice(0, 60) + '...' : text,
        regexResult: extracted,
        fallbackResult: fallback,
      });
    }
    setResults(tests);
  };

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
        <TestTube className="w-4 h-4 text-primary-400" />
        SMS Regex Tester
      </h2>

      <div className="space-y-3 mb-4">
        <div>
          <label className="label">Custom Regex Pattern</label>
          <input className="input font-mono text-xs" value={regexStr} onChange={(e) => setRegexStr(e.target.value)} placeholder="انتقال:(\d+[,\d]*)\+" />
        </div>
        <div>
          <label className="label">Custom SMS Text (optional)</label>
          <textarea className="input min-h-[60px] resize-y font-mono text-xs" value={customSms} onChange={(e) => setCustomSms(e.target.value)} placeholder="Paste a bank SMS to test..." />
        </div>
        <button onClick={testRegex} className="btn-primary text-sm">
          <Play className="w-4 h-4" />
          Run Test
        </button>
      </div>

      {results && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div key={i} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 text-xs">
              <p className="text-gray-400 mb-1.5 font-mono">{r.text}</p>
              <div className="flex gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Custom:</span>
                  <span className={r.regexResult && typeof r.regexResult === 'number' ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
                    {r.regexResult || 'No match'}
                  </span>
                  {typeof r.regexResult === 'number' ? <Check className="w-3 h-3 text-green-500" /> : <X className="w-3 h-3 text-red-500" />}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Fallback:</span>
                  <span className={r.fallbackResult ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
                    {r.fallbackResult || 'No match'}
                  </span>
                  {r.fallbackResult ? <Check className="w-3 h-3 text-green-500" /> : <X className="w-3 h-3 text-red-500" />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Finance() {
  const [cryptomusKey, setCryptomusKey] = useState('');
  const [cryptomusMerchant, setCryptomusMerchant] = useState('');
  const [cryptomusWebhook, setCryptomusWebhook] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await api.get('/enterprise/settings', { params: { group: 'payments' } });
      const settings = res.data.data || [];
      const getVal = (key) => {
        const s = settings.find((s) => s.key === key);
        return s ? s.value : '';
      };
      setCryptomusKey(getVal('cryptomusApiKey'));
      setCryptomusMerchant(getVal('cryptomusMerchantId'));
      setCryptomusWebhook(getVal('cryptomusWebhookSecret'));
    } catch {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const saveCryptomus = async () => {
    setSaving(true);
    try {
      await Promise.all([
        api.put('/enterprise/settings/cryptomusApiKey', { value: cryptomusKey }),
        api.put('/enterprise/settings/cryptomusMerchantId', { value: cryptomusMerchant }),
        api.put('/enterprise/settings/cryptomusWebhookSecret', { value: cryptomusWebhook }),
      ]);
      toast.success('Cryptomus settings saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveSmsRegex = async (regex) => {
    try {
      await api.put('/enterprise/bot-config', { smsBankRegex: regex });
      toast.success('SMS regex saved');
    } catch (err) {
      toast.error('Failed to save SMS regex');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="w-6 h-6 text-primary-400" />
          Finance
        </h1>
        <p className="text-sm text-gray-400 mt-1">Manage payment gateways and test SMS parsing</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <Key className="w-4 h-4 text-primary-400" />
              Cryptomus API Keys
            </h2>
            <div className="space-y-3">
              <div>
                <label className="label">API Key</label>
                <div className="relative">
                  <input className="input pr-10 font-mono text-xs" type={showKeys ? 'text' : 'password'} value={cryptomusKey} onChange={(e) => setCryptomusKey(e.target.value)} placeholder="Enter Cryptomus API key" />
                </div>
              </div>
              <div>
                <label className="label">Merchant ID</label>
                <input className="input font-mono text-xs" type={showKeys ? 'text' : 'password'} value={cryptomusMerchant} onChange={(e) => setCryptomusMerchant(e.target.value)} placeholder="Enter Merchant UUID" />
              </div>
              <div>
                <label className="label">Webhook Secret</label>
                <input className="input font-mono text-xs" type={showKeys ? 'text' : 'password'} value={cryptomusWebhook} onChange={(e) => setCryptomusWebhook(e.target.value)} placeholder="Enter webhook secret" />
              </div>
              <div className="flex items-center justify-between pt-1">
                <button onClick={() => setShowKeys(!showKeys)} className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1">
                  {showKeys ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showKeys ? 'Hide' : 'Show'} keys
                </button>
                <button onClick={saveCryptomus} disabled={saving} className="btn-primary text-xs py-1.5 px-4">
                  <Save className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <RegexTester />
        </div>
      </div>
    </div>
  );
}
