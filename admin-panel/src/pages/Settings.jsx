import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/settings');
      setSettings(res.data.data.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {}));
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

  if (loading) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <div className="max-w-2xl">
        <div className="card space-y-6">
          {Object.entries(settings).map(([key, value]) => (
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
    </div>
  );
}
