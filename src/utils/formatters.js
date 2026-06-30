import { t } from './i18n.js';

/**
 * Currency unit per language. Amounts are always rendered with LATIN digits
 * (explicit product decision — Persian numerals ۰-۹ are NOT used) regardless
 * of language; only the unit word/locale changes.
 */
const CURRENCY_UNIT = {
  en: 'IRR',
  fa: 'تومان',
  ru: '₽',
};

export function formatCurrency(amount, lang = 'fa') {
  const unit = CURRENCY_UNIT[lang] || CURRENCY_UNIT.fa;
  return `${Number(amount).toLocaleString('en-US')} ${unit}`;
}

// Backward-compatible alias (existing callers use formatRials).
export function formatRials(amount, lang = 'fa') {
  return formatCurrency(amount, lang);
}

export const RANK_DATA = {
  egg:    { emoji: '🥚', key: 'rank_egg',    minSpent: 0 },
  worker: { emoji: '🐝', key: 'rank_worker', minSpent: 1 },
  hunter: { emoji: '⚔️', key: 'rank_hunter', minSpent: 1_000_000 },
  queen:  { emoji: '👑', key: 'rank_queen',  minSpent: 5_000_000 },
};

export function calculateRank(totalSpent) {
  if (totalSpent >= 5_000_000) return 'queen';
  if (totalSpent >= 1_000_000) return 'hunter';
  if (totalSpent > 0) return 'worker';
  return 'egg';
}

export function formatRank(rank, lang = 'fa') {
  const r = RANK_DATA[rank];
  if (!r) return t('rank_default', lang);
  return `${r.emoji} ${t(r.key, lang)}`;
}

export function formatBytes(bytes, lang = 'fa') {
  const GB = 1073741824;
  if (bytes === null || bytes === undefined) return t('unlimited', lang);
  const gb = bytes / GB;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DATE_LOCALE = {
  en: 'en-US',
  fa: 'fa-IR-u-nu-latn', // Persian calendar/wording but Latin digits
  ru: 'ru-RU',
};

export function formatDate(date, lang = 'fa') {
  if (!date) return '—';
  const locale = DATE_LOCALE[lang] || DATE_LOCALE.fa;
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}
