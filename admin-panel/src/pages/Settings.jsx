import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../i18n';
import {
  updateSetting, getForceJoin, updateForceJoin, getBotConfig, updateBotConfig, applyBotCommands,
} from '../api/endpoints';

function Section({ title, children }) {
  return (
    <div className="card">
      <h2 className="font-semibold text-primary-400 mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const [card, setCard] = useState('');
  const [support, setSupport] = useState('');
  const [fj, setFj] = useState({ enabled: false, channels: [] });
  const [delivery, setDelivery] = useState({ fa: '', en: '', ru: '' });
  const [botDesc, setBotDesc] = useState({ fa: '', en: '', ru: '' });
  const [lang, setLang] = useState('fa');

  useEffect(() => {
    getForceJoin().then((r) => setFj(r.data.data || { enabled: false, channels: [] })).catch(() => {});
    getBotConfig().then((r) => {
      const d = r.data.data || {};
      setDelivery({ fa: d.deliveryTemplate?.fa || '', en: d.deliveryTemplate?.en || '', ru: d.deliveryTemplate?.ru || '' });
      setBotDesc({ fa: d.botDescription?.fa || '', en: d.botDescription?.en || '', ru: d.botDescription?.ru || '' });
    }).catch(() => {});
  }, []);

  const saveGeneral = async () => {
    try {
      if (card) await updateSetting('payment.cardNumber', card);
      if (support) await updateSetting('support.contact', support);
      toast.success(t('settingsp.saved'));
    } catch { toast.error('Error'); }
  };
  const saveForceJoin = async () => {
    try { const r = await updateForceJoin(fj); setFj(r.data.data); toast.success(t('settingsp.saved')); }
    catch { toast.error('Error'); }
  };
  const saveBotConfig = async () => {
    try { await updateBotConfig({ deliveryTemplate: delivery, botDescription: botDesc }); toast.success(t('settingsp.saved')); }
    catch { toast.error('Error'); }
  };
  const doApplyCommands = async () => {
    try { await applyBotCommands(); toast.success(t('settingsp.applied')); }
    catch { toast.error('Error'); }
  };

  const addChannel = () => setFj((s) => ({ ...s, channels: [...s.channels, { id: '', title: '', inviteLink: '' }] }));
  const setChannel = (i, k, v) => setFj((s) => ({ ...s, channels: s.channels.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const removeChannel = (i) => setFj((s) => ({ ...s, channels: s.channels.filter((_, j) => j !== i) }));

  const LangTabs = () => (
    <div className="flex gap-2 mb-3">
      {['fa', 'en', 'ru'].map((l) => (
        <button key={l} onClick={() => setLang(l)}
          className={`px-3 py-1 rounded text-sm ${lang === l ? 'bg-primary-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t('settingsp.title')}</h1>

      <Section title={t('settingsp.general')}>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">{t('settingsp.card')}</label><input className="input" value={card} onChange={(e) => setCard(e.target.value)} placeholder="6037-9982-…" /></div>
          <div><label className="label">{t('settingsp.support')}</label><input className="input" value={support} onChange={(e) => setSupport(e.target.value)} placeholder="@support" /></div>
        </div>
        <button className="btn-primary mt-4" onClick={saveGeneral}>{t('settingsp.save')}</button>
      </Section>

      <Section title={t('settingsp.forceJoin')}>
        <label className="flex items-center gap-2 mb-4">
          <input type="checkbox" checked={fj.enabled} onChange={(e) => setFj((s) => ({ ...s, enabled: e.target.checked }))} />
          {t('settingsp.forceJoinEnabled')}
        </label>
        <div className="space-y-2">
          {fj.channels.map((c, i) => (
            <div key={i} className="grid md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
              <input className="input" placeholder={t('settingsp.channelId')} value={c.id} onChange={(e) => setChannel(i, 'id', e.target.value)} />
              <input className="input" placeholder={t('settingsp.channelTitle')} value={c.title} onChange={(e) => setChannel(i, 'title', e.target.value)} />
              <input className="input" placeholder={t('settingsp.inviteLink')} value={c.inviteLink} onChange={(e) => setChannel(i, 'inviteLink', e.target.value)} />
              <button className="btn-danger" onClick={() => removeChannel(i)}>{t('settingsp.remove')}</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-secondary" onClick={addChannel}>+ {t('settingsp.addChannel')}</button>
          <button className="btn-primary" onClick={saveForceJoin}>{t('settingsp.save')}</button>
        </div>
      </Section>

      <Section title={t('settingsp.delivery')}>
        <LangTabs />
        <textarea className="input min-h-[120px] font-mono text-sm" value={delivery[lang]} onChange={(e) => setDelivery((s) => ({ ...s, [lang]: e.target.value }))} />
        <div className="text-xs text-gray-500 mt-1">{t('settingsp.deliveryHint')}</div>
        <button className="btn-primary mt-4" onClick={saveBotConfig}>{t('settingsp.save')}</button>
      </Section>

      <Section title={t('settingsp.botCommands')}>
        <LangTabs />
        <label className="label">{t('settingsp.botDescription')}</label>
        <textarea className="input min-h-[80px]" value={botDesc[lang]} onChange={(e) => setBotDesc((s) => ({ ...s, [lang]: e.target.value }))} />
        <div className="flex gap-2 mt-4">
          <button className="btn-primary" onClick={saveBotConfig}>{t('settingsp.save')}</button>
          <button className="btn-secondary" onClick={doApplyCommands}>{t('settingsp.applyCommands')}</button>
        </div>
      </Section>
    </div>
  );
}
