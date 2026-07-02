/**
 * Language-based plan pricing.
 *
 * Product rules:
 *  - fa (Persian) → price in Toman; pays via card-to-card / wallet.
 *  - en / ru      → price in USD;   pays via cryptocurrency only.
 *
 * fa falls back to `plan.basePrice` when `plan.prices.fa` is not set, so legacy
 * plans keep working.
 */
import { formatRials } from './formatters.js';

/**
 * @returns {{ amount:number, currency:'IRT'|'USD', lang:string }}
 */
export function getPlanPrice(plan, lang = 'fa') {
  const p = (plan && plan.prices) || {};
  if (lang === 'en') return { amount: Number(p.en ?? 0), currency: 'USD', lang: 'en' };
  if (lang === 'ru') return { amount: Number(p.ru ?? 0), currency: 'USD', lang: 'ru' };
  const toman = p.fa != null ? Number(p.fa) : Number(plan?.basePrice ?? 0);
  return { amount: toman, currency: 'IRT', lang: 'fa' };
}

/** Human-readable price in the user's language/currency. */
export function formatPlanPrice(plan, lang = 'fa') {
  const { amount, currency } = getPlanPrice(plan, lang);
  if (currency === 'USD') return `$${Number(amount).toLocaleString('en-US')}`;
  return formatRials(amount, 'fa');
}

/** True for Toman-paying (Iranian) languages, false for USD/crypto languages. */
export function isTomanLang(lang) {
  return !lang || lang === 'fa';
}
