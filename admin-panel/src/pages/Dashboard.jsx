import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { useI18n } from '../i18n';

function toman(n) {
  return `${Number(n || 0).toLocaleString('en-US')}`;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="card">
      <div className="text-gray-400 text-sm">{label}</div>
      <div className={`text-3xl font-bold ${accent ? 'text-primary-500' : 'text-gray-100'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function RevenueBars({ series, t }) {
  if (!series?.length) {
    return <div className="text-gray-500 text-sm py-8 text-center">{t('dash.noRevenue')}</div>;
  }
  const max = Math.max(...series.map((d) => d.revenue), 1);
  return (
    <div className="flex items-end gap-1 h-40" dir="ltr">
      {series.map((d) => (
        <div key={d._id} className="flex-1 flex flex-col items-center justify-end group" title={`${d._id}: ${toman(d.revenue)}`}>
          <div
            className="w-full rounded-t bg-primary-600 group-hover:bg-primary-400 transition-all"
            style={{ height: `${Math.max(4, (d.revenue / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/dashboard')
      .then((res) => setData(res.data.data))
      .catch(() => toast.error(t('dash.loadError')))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  if (loading) return <div className="text-center py-8 text-gray-400">{t('common.loading')}</div>;

  const unit = t('dash.currency');
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t('nav.dashboard')}</h1>

      {/* Revenue row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard accent label={t('dash.revenueToday')} value={`${toman(data?.revenueToday)} ${unit}`} sub={`${data?.salesToday || 0} ${t('dash.sales')}`} />
        <StatCard label={t('dash.revenue7d')} value={`${toman(data?.revenue7d)} ${unit}`} />
        <StatCard label={t('dash.revenue30d')} value={`${toman(data?.revenue30d)} ${unit}`} />
        <StatCard label={t('dash.revenueAll')} value={`${toman(data?.revenueAllTime)} ${unit}`} />
      </div>

      {/* Chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-200">{t('dash.revenue30dChart')}</h2>
          <span className="text-xs text-gray-500">{unit}</span>
        </div>
        <RevenueBars series={data?.dailySeries} t={t} />
      </div>

      {/* Ops row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label={t('dash.totalUsers')} value={data?.totalUsers || 0} sub={`+${data?.newUsersToday || 0} ${t('dash.today')}`} />
        <StatCard label={t('dash.activeSubs')} value={data?.activeSubscriptions || 0} />
        <StatCard label={t('dash.onHold')} value={data?.onHoldSubs || 0} />
        <StatCard label={t('dash.expired')} value={data?.expiredSubs || 0} />
        <StatCard label={t('dash.pendingReceipts')} value={data?.pendingReceipts || 0} accent={data?.pendingReceipts > 0} />
        <StatCard label={t('dash.resellers')} value={data?.resellers || 0} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('dash.plans')} value={data?.totalPlans || 0} />
        <StatCard label={t('dash.trials')} value={data?.trialsClaimed || 0} />
      </div>

      <div className="text-xs text-gray-600">
        {t('dash.updated')}: {data?.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : '-'}
      </div>
    </div>
  );
}
