import { t, SUPPORTED_LANGS } from '../utils/i18n.js';

const BUTTON_KEYS = {
  rk_renew: 'buy_renew',
  rk_buy: 'buy_renew',
  rk_pricing: 'pricing_list',
  rk_my_services: 'my_subscriptions',
  rk_free_trial: 'free_trial',
  rk_profile: 'profile',
  rk_reseller: 'reseller_entry',
  rk_wallet: 'wallet_menu',
  rk_faq: 'faq',
  rk_connection_guide: 'connection_guide',
  rk_support: 'contact_support',
};

// label (in every supported language) -> action name
const LABEL_TO_ACTION = new Map();
for (const [i18nKey, action] of Object.entries(BUTTON_KEYS)) {
  for (const lang of SUPPORTED_LANGS) {
    LABEL_TO_ACTION.set(t(i18nKey, lang), action);
  }
}

/**
 * Returns the action name for a persistent reply-keyboard button's exact
 * text, or null if `text` doesn't match any known button (i.e. it's a
 * regular chat message that should fall through to other handlers).
 */
export function matchReplyButton(text) {
  return LABEL_TO_ACTION.get(text) || null;
}
