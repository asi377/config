import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../i18n';
import {
  getUsers, getPlans, getUserPurchases, walletTopup, activateUserPlan, reactivateTrial,
} from '../api/endpoints';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const displayName = (u) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || (u.username ? `@${u.username}` : '—');

function UserDetailModal({ user, plans, onClose, t, onChanged }) {
  const [purchases, setPurchases] = useState(null);
  const [topup, setTopup] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getUserPurchases(user._id)
      .then((r) => setPurchases(r.data.data))
      .catch(() => setPurchases({ subscriptions: [], receipts: [] }));
  }, [user._id]);

  const doTopup = async () => {
    const amount = parseInt(topup, 10);
    if (!amount) return;
    setBusy(true);
    try { await walletTopup(user._id, amount); toast.success(t('users.toppedUp')); setTopup(''); onChanged(); }
    catch { toast.error('Error'); } finally { setBusy(false); }
  };
  const doActivate = async () => {
    if (!planId) return;
    setBusy(true);
    try { await activateUserPlan(user._id, planId); toast.success(t('users.activated')); onChanged(); }
    catch { toast.error('Error'); } finally { setBusy(false); }
  };
  const doTrial = async () => {
    setBusy(true);
    try { await reactivateTrial(user._id); toast.success(t('users.trialReset')); }
    catch { toast.error('Error'); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">{displayName(user)}</h2>
            <div className="text-sm text-gray-400">ID: {user.telegramId} {user.username && `· @${user.username}`}</div>
          </div>
          <button className="btn-secondary" onClick={onClose}>{t('users.close')}</button>
        </div>

        <div className="card mb-4">
          <h3 className="font-semibold mb-3 text-primary-400">{t('users.quickActions')}</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">{t('users.walletTopup')}</label>
              <div className="flex gap-2">
                <input className="input" type="number" placeholder={t('users.amount')} value={topup} onChange={(e) => setTopup(e.target.value)} />
                <button className="btn-primary whitespace-nowrap" disabled={busy} onClick={doTopup}>{t('users.apply')}</button>
              </div>
              <div className="text-xs text-gray-500 mt-1">{t('users.balance')}: {fmt(user.walletBalance)} {t('dash.currency')}</div>
            </div>
            <div>
              <label className="label">{t('users.activatePlan')}</label>
              <div className="flex gap-2">
                <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">{t('users.selectPlan')}</option>
                  {plans.map((p) => <option key={p._id} value={p._id}>{p.title}</option>)}
                </select>
                <button className="btn-primary whitespace-nowrap" disabled={busy} onClick={doActivate}>{t('users.apply')}</button>
              </div>
            </div>
            <div>
              <label className="label">{t('users.reactivateTrial')}</label>
              <button className="btn-secondary w-full" disabled={busy} onClick={doTrial}>{t('users.reactivateTrial')}</button>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold mb-3 text-primary-400">{t('users.purchaseHistory')}</h3>
          {!purchases ? <div className="text-gray-500">{t('common.loading')}</div> : (
            <>
              <div className="text-sm text-gray-400 mb-1">{t('users.subscriptions')}</div>
              {purchases.subscriptions?.length ? (
                <table className="table mb-4">
                  <thead><tr><th>{t('users.plan')}</th><th>{t('users.status')}</th><th>{t('users.date')}</th></tr></thead>
                  <tbody>
                    {purchases.subscriptions.map((s) => (
                      <tr key={s._id}>
                        <td>{s.planId?.title || '—'} {s.planId?.isTrial && <span className="badge">{t('users.trial')}</span>}</td>
                        <td>{s.status}</td>
                        <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="text-gray-600 text-sm mb-4">{t('users.none')}</div>}

              <div className="text-sm text-gray-400 mb-1">{t('users.receipts')}</div>
              {purchases.receipts?.length ? (
                <table className="table">
                  <thead><tr><th>{t('users.plan')}</th><th>{t('users.amountCol')}</th><th>{t('users.status')}</th><th>{t('users.date')}</th></tr></thead>
                  <tbody>
                    {purchases.receipts.map((r) => (
                      <tr key={r._id}>
                        <td>{r.planId?.title || '—'}</td>
                        <td>{fmt(r.amount)}</td>
                        <td>{r.status}</td>
                        <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="text-gray-600 text-sm">{t('users.none')}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function UserManagement() {
  const { t } = useI18n();
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getUsers(page);
      let list = res.data.data.users || [];
      setPages(res.data.data.pages || 1);
      if (search) {
        const s = search.toLowerCase();
        list = list.filter((u) => `${u.telegramId} ${u.firstName} ${u.lastName} ${u.username}`.toLowerCase().includes(s));
      }
      setUsers(list);
    } catch { toast.error('Failed to load users'); } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getPlans().then((r) => setPlans(r.data.data || [])).catch(() => {}); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-bold">{t('users.title')}</h1>
        <input className="input max-w-xs" placeholder={t('users.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? <div className="text-gray-400">{t('common.loading')}</div> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('users.name')}</th><th>{t('users.id')}</th><th>{t('users.username')}</th>
                <th>{t('users.balance')}</th><th>{t('users.joined')}</th><th>{t('users.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id}>
                  <td className="font-medium">{displayName(u)}</td>
                  <td className="text-gray-400">{u.telegramId}</td>
                  <td className="text-gray-400">{u.username ? `@${u.username}` : '—'}</td>
                  <td>{fmt(u.walletBalance)}</td>
                  <td className="text-gray-500">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <button className="btn-primary text-sm py-1" onClick={() => setSelected(u)}>{t('users.view')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!users.length && <div className="text-gray-600 text-center py-6">{t('users.none')}</div>}
        </div>
      )}

      <div className="flex items-center gap-2 justify-center">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
        <span className="text-gray-400">{page} / {pages}</span>
        <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>›</button>
      </div>

      {selected && (
        <UserDetailModal user={selected} plans={plans} t={t} onClose={() => setSelected(null)} onChanged={load} />
      )}
    </div>
  );
}
