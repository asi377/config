import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../i18n';
import { getPlans, createPlan, updatePlan, deletePlan } from '../api/endpoints';

const EMPTY = {
  title: '', subtitle: '', category: 'عمومی', type: 'normal',
  baseVolumeGB: 30, durationDays: 30, maxSubLinks: 1, basePrice: 0,
  prices: { fa: '', en: '', ru: '' }, isTrial: false, isActive: true,
};

function PlanForm({ initial, onSave, onCancel, t }) {
  const [form, setForm] = useState({ ...EMPTY, ...initial, prices: { ...EMPTY.prices, ...(initial?.prices || {}) } });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setPrice = (lang, v) => setForm((f) => ({ ...f, prices: { ...f.prices, [lang]: v } }));

  const submit = () => {
    const payload = {
      ...form,
      baseVolumeGB: Number(form.baseVolumeGB),
      durationDays: Number(form.durationDays),
      maxSubLinks: Number(form.maxSubLinks) || 1,
      basePrice: Number(form.prices.fa || form.basePrice || 0),
      prices: {
        fa: form.prices.fa === '' ? null : Number(form.prices.fa),
        en: form.prices.en === '' ? null : Number(form.prices.en),
        ru: form.prices.ru === '' ? null : Number(form.prices.ru),
      },
    };
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">{initial?._id ? t('plans.edit') : t('plans.add')}</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">{t('plans.name')}</label><input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div><label className="label">{t('plans.subtitle')}</label><input className="input" value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} /></div>
          <div>
            <label className="label">{t('plans.type')}</label>
            <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
              {['economy', 'normal', 'vip', 'static_ip'].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div><label className="label">{t('plans.category')}</label><input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} /></div>
          <div><label className="label">{t('plans.volume')}</label><input className="input" type="number" value={form.baseVolumeGB} onChange={(e) => set('baseVolumeGB', e.target.value)} /></div>
          <div><label className="label">{t('plans.duration')}</label><input className="input" type="number" value={form.durationDays} onChange={(e) => set('durationDays', e.target.value)} /></div>
          <div><label className="label">{t('plans.maxLinks')}</label><input className="input" type="number" value={form.maxSubLinks} onChange={(e) => set('maxSubLinks', e.target.value)} /></div>
        </div>

        <div className="mt-4">
          <label className="label">{t('plans.pricing')}</label>
          <div className="grid md:grid-cols-3 gap-4">
            <div><span className="text-xs text-gray-400">{t('plans.priceFa')}</span><input className="input" type="number" value={form.prices.fa} onChange={(e) => setPrice('fa', e.target.value)} /></div>
            <div><span className="text-xs text-gray-400">{t('plans.priceEn')}</span><input className="input" type="number" value={form.prices.en} onChange={(e) => setPrice('en', e.target.value)} /></div>
            <div><span className="text-xs text-gray-400">{t('plans.priceRu')}</span><input className="input" type="number" value={form.prices.ru} onChange={(e) => setPrice('ru', e.target.value)} /></div>
          </div>
        </div>

        <div className="flex items-center gap-6 mt-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isTrial} onChange={(e) => set('isTrial', e.target.checked)} />{t('plans.isTrial')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />{t('plans.active')}</label>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button className="btn-secondary" onClick={onCancel}>{t('plans.cancel')}</button>
          <button className="btn-primary" onClick={submit}>{t('plans.save')}</button>
        </div>
      </div>
    </div>
  );
}

export default function PlanManagement() {
  const { t } = useI18n();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // {} for new, plan for edit

  const load = () => {
    setLoading(true);
    getPlans().then((r) => setPlans(r.data.data || [])).catch(() => toast.error('Failed to load plans')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async (payload) => {
    try {
      if (editing?._id) await updatePlan(editing._id, payload);
      else await createPlan(payload);
      toast.success(t('plans.saved')); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Error'); }
  };
  const remove = async (id) => {
    if (!window.confirm(t('plans.confirmDelete'))) return;
    try { await deletePlan(id); toast.success(t('plans.deleted')); load(); } catch { toast.error('Error'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('plans.title')}</h1>
        <button className="btn-primary" onClick={() => setEditing({})}>+ {t('plans.add')}</button>
      </div>

      {loading ? <div className="text-gray-400">{t('common.loading')}</div> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('plans.name')}</th><th>{t('plans.type')}</th><th>{t('plans.volume')}</th><th>{t('plans.duration')}</th>
                <th>FA</th><th>EN</th><th>RU</th><th>{t('plans.active')}</th><th>{t('users.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p._id}>
                  <td className="font-medium">{p.title} {p.isTrial && <span className="badge">{t('users.trial')}</span>}</td>
                  <td>{p.type}</td>
                  <td>{p.baseVolumeGB}GB</td>
                  <td>{p.durationDays}d</td>
                  <td>{(p.prices?.fa ?? p.basePrice) || 0}</td>
                  <td>{p.prices?.en != null ? `$${p.prices.en}` : '—'}</td>
                  <td>{p.prices?.ru != null ? `$${p.prices.ru}` : '—'}</td>
                  <td>{p.isActive ? '✅' : '❌'}</td>
                  <td className="flex gap-2">
                    <button className="btn-secondary text-sm py-1" onClick={() => setEditing(p)}>{t('plans.edit')}</button>
                    <button className="btn-danger text-sm py-1" onClick={() => remove(p._id)}>{t('plans.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!plans.length && <div className="text-gray-600 text-center py-6">{t('users.none')}</div>}
        </div>
      )}

      {editing && <PlanForm initial={editing} t={t} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}
