import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';

const emptyButton = () => ({
  key: '',
  label: { fa: '', en: '', ru: '' },
  text: { fa: '', en: '', ru: '' },
  links: [],
  enabled: true,
  order: 0,
});

export default function CustomButtons() {
  const [buttons, setButtons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchButtons(); }, []);

  const fetchButtons = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/custom-buttons');
      setButtons(Array.isArray(res.data.data) ? res.data.data : []);
    } catch {
      toast.error('Failed to load custom buttons');
    } finally {
      setLoading(false);
    }
  };

  const update = (idx, path, value) => {
    setButtons((prev) => prev.map((b, i) => {
      if (i !== idx) return b;
      if (path.includes('.')) {
        const [grp, lang] = path.split('.');
        return { ...b, [grp]: { ...b[grp], [lang]: value } };
      }
      return { ...b, [path]: value };
    }));
  };

  const updateLink = (bi, li, field, value) => {
    setButtons((prev) => prev.map((b, i) => i !== bi ? b : {
      ...b, links: b.links.map((l, j) => j !== li ? l : { ...l, [field]: value }),
    }));
  };
  const addLink = (bi) => setButtons((prev) => prev.map((b, i) => i !== bi ? b : { ...b, links: [...b.links, { label: '', url: '' }] }));
  const removeLink = (bi, li) => setButtons((prev) => prev.map((b, i) => i !== bi ? b : { ...b, links: b.links.filter((_, j) => j !== li) }));

  const addButton = () => setButtons((prev) => [...prev, { ...emptyButton(), order: prev.length }]);
  const removeButton = (idx) => setButtons((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    for (const b of buttons) {
      if (!b.key.trim()) { toast.error('Every button needs a key'); return; }
      if (!b.label.fa && !b.label.en && !b.label.ru) { toast.error(`Button "${b.key}" needs a label`); return; }
    }
    try {
      setSaving(true);
      await api.put('/admin/custom-buttons', { customButtons: buttons });
      toast.success('Custom buttons saved');
      fetchButtons();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Custom Buttons / دکمه‌های دلخواه</h1>
        <button onClick={save} className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save All'}
        </button>
      </div>
      <p className="text-sm text-gray-400 max-w-3xl">
        دکمه‌های اطلاعاتی دلخواه که به منوی پایین ربات اضافه می‌شوند. وقتی کاربر روی دکمه بزند، متنی که
        تعریف می‌کنی (به‌علاوه‌ی لینک‌های دلخواه) نمایش داده می‌شود. این دکمه‌ها روی دکمه‌های اصلی ربات
        (خرید، کیف پول و…) تأثیری ندارند. (Add informational buttons; they don't affect the core bot buttons.)
      </p>

      {buttons.map((b, idx) => (
        <div key={idx} className="card space-y-3">
          <div className="flex items-center justify-between">
            <input
              className="input max-w-xs" placeholder="key (e.g. tutorial)"
              value={b.key} onChange={(e) => update(idx, 'key', e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={b.enabled !== false} onChange={(e) => update(idx, 'enabled', e.target.checked)} />
              Enabled
            </label>
            <button className="btn btn-danger" onClick={() => removeButton(idx)}>Remove</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {['fa', 'en', 'ru'].map((lang) => (
              <div key={lang}>
                <label className="label">Button label ({lang})</label>
                <input className="input" value={b.label?.[lang] || ''} onChange={(e) => update(idx, `label.${lang}`, e.target.value)} />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {['fa', 'en', 'ru'].map((lang) => (
              <div key={lang}>
                <label className="label">Message shown ({lang})</label>
                <textarea className="input min-h-[70px]" value={b.text?.[lang] || ''} onChange={(e) => update(idx, `text.${lang}`, e.target.value)} />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <label className="label">Link buttons (optional)</label>
            {(b.links || []).map((l, li) => (
              <div key={li} className="flex gap-2">
                <input className="input" placeholder="Label" value={l.label} onChange={(e) => updateLink(idx, li, 'label', e.target.value)} />
                <input className="input" placeholder="https://..." value={l.url} onChange={(e) => updateLink(idx, li, 'url', e.target.value)} />
                <button className="btn btn-danger" onClick={() => removeLink(idx, li)}>×</button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={() => addLink(idx)}>+ Add Link</button>
          </div>
        </div>
      ))}

      <button onClick={addButton} className="btn btn-secondary">+ Add Custom Button</button>
    </div>
  );
}
