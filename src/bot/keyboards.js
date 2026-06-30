/**
 * keyboards.js
 *
 * Single source-of-truth for every Telegraf inline keyboard in the bot.
 *
 * All keyboards are now lang-aware generator functions: generateXxx(lang, ...).
 * Labels are resolved via t(key, lang). All generators are pure functions
 * — no DB calls, no side-effects.
 */

import { Markup } from 'telegraf';
import { t } from '../utils/i18n.js';

// ─── Shared: persistent "Change Language" row ────────────────────────────────
/**
 * Per explicit product requirement, this button's label is always the
 * English text "Change Language" regardless of the selected language.
 */
function changeLanguageRow() {
  return [Markup.button.callback('🌐 Change Language', 'change_language')];
}

// ─── Main user menu ────────────────────────────────────────────────────────
/**
 * @param {string} lang
 * @param {object|null} [user] - when provided, adds a single "Reseller" row
 *   that routes to the mini-panel (if already a reseller) or the
 *   application menu (if not).
 */
export function mainMenuKeyboard(lang, user) {
  const rows = [
    [Markup.button.callback(t('btn_my_subscriptions', lang), 'my_subscriptions')],
    [Markup.button.callback(t('btn_buy_renew', lang), 'buy_renew')],
    [Markup.button.callback(t('btn_free_trial', lang), 'free_trial')],
    [Markup.button.callback(t('btn_profile', lang), 'profile')],
  ];

  if (user) {
    rows.push([Markup.button.callback(
      t('btn_reseller', lang),
      user.isReseller ? 'reseller_panel' : 'reseller_menu',
    )]);
  }

  rows.push(changeLanguageRow());
  return Markup.inlineKeyboard(rows);
}

// ─── Dynamic: reseller tier application menu ───────────────────────────────
/**
 * @param {string} lang
 * @param {Array<{_id: string, displayName: string, maxActiveAccounts: number|null, discountPercent: number, applicationFee: number}>} plans
 */
export function generateResellerMenuKeyboard(lang, plans) {
  if (!plans || plans.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback(t('reseller_no_tiers', lang), 'main_menu')],
      [Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')],
    ]);
  }

  const rows = plans.map((p) => {
    const cap = p.maxActiveAccounts === null || p.maxActiveAccounts === undefined
      ? t('reseller_cap_unlimited', lang)
      : String(p.maxActiveAccounts);
    const label = t('reseller_tier_item', lang, {
      name: p.displayName,
      cap,
      discount: p.discountPercent,
      fee: p.applicationFee || 0,
    });
    return [Markup.button.callback(label, `reseller_apply_${p._id}`)];
  });

  rows.push([Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')]);
  return Markup.inlineKeyboard(rows);
}

// ─── Admin panel ──────────────────────────────────────────────────────────
export function adminMenuKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('admin_btn_dashboard_short', lang), 'admin_dashboard'),
     Markup.button.callback(t('admin_btn_users_short', lang), 'admin_users')],
    [Markup.button.callback(t('admin_btn_servers', lang), 'admin_servers'),
     Markup.button.callback(t('admin_btn_plans_short', lang), 'admin_plans')],
    [Markup.button.callback(t('admin_btn_finance_short', lang), 'admin_finance'),
     Markup.button.callback(t('admin_btn_broadcast_short', lang), 'admin_bot')],
    [Markup.button.callback(t('admin_btn_bandwidth', lang), 'admin_bandwidth'),
     Markup.button.callback(t('admin_btn_security', lang), 'admin_security')],
    [Markup.button.callback(t('admin_btn_analytics', lang), 'admin_analytics'),
     Markup.button.callback(t('admin_btn_tickets', lang), 'admin_tickets')],
    [Markup.button.callback(t('admin_btn_backup', lang), 'admin_backup'),
     Markup.button.callback(t('admin_btn_metrics', lang), 'admin_metrics')],
    [Markup.button.callback(t('admin_btn_subscriptions', lang), 'admin_subscriptions'),
     Markup.button.callback(t('admin_btn_receipts', lang), 'admin_receipts')],
    [Markup.button.callback(t('admin_btn_promocodes', lang), 'admin_promocodes'),
     Markup.button.callback(t('admin_btn_settings', lang), 'admin_settings')],
    [Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')],
  ]);
}

// ─── Shared back buttons ──────────────────────────────────────────────────
export function adminBackKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('admin_btn_back_to_panel', lang), 'admin_back')],
  ]);
}

// ─── Basic subscription actions ───────────────────────────────────────────
export function subscriptionActionsKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('btn_get_config', lang), 'get_config')],
    [Markup.button.callback(t('btn_create_sublink', lang), 'create_sublink')],
    [Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')],
  ]);
}

// ─── Dynamic: server list with health indicators ──────────────────────────
/**
 * Renders an inline keyboard of servers with live health emoji.
 *
 * Health → emoji mapping:
 *   healthy   → 🟢
 *   degraded  → 🟡
 *   unhealthy → 🔴
 *   unknown   → ⚪
 *   offline   → ⚫
 *
 * Each button fires `admin_server_detail_<serverId>`.
 *
 * @param {string} lang
 * @param {Array<{_id: string, name: string, healthStatus: string, loadPercent: number, status: string}>} servers
 * @returns {Markup}
 */
export function generateServersKeyboard(lang, servers) {
  if (!servers || servers.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback(t('btn_no_servers', lang), 'admin_servers')],
      [Markup.button.callback(t('btn_back', lang), 'admin_back')],
    ]);
  }

  const healthEmoji = {
    healthy:   '🟢',
    degraded:  '🟡',
    unhealthy: '🔴',
    unknown:   '⚪',
    offline:   '⚫',
  };

  const serverRows = servers.map(s => {
    const health = s.status === 'offline'
      ? healthEmoji.offline
      : (healthEmoji[s.healthStatus] || healthEmoji.unknown);
    const load   = typeof s.loadPercent === 'number' ? ` (${s.loadPercent}%)` : '';
    const label  = `${health} ${s.name}${load}`;
    return [Markup.button.callback(label, `admin_server_detail_${s._id}`)];
  });

  serverRows.push([Markup.button.callback(t('admin_btn_back_to_panel', lang), 'admin_back')]);
  return Markup.inlineKeyboard(serverRows);
}

// ─── Dynamic: user subscription panel ──────────────────────────────────────
/**
 * Generates a context-sensitive inline keyboard for a user based on their
 * subscription status.
 *
 * Status rules:
 *   active    → Get Link (client picker), Create Sub-Link, Profile
 *   on_hold   → message only — no connect yet, Update UUID, Profile
 *   expired   → Renew, Profile
 *   suspended → Contact Support, Profile
 *   (none)    → Buy Plan, Free Trial
 *
 * @param {string} lang
 * @param {object|null} user
 * @param {object|null} subscription  - Most-relevant subscription (or null)
 * @returns {Markup}
 */
export function generateUserPanel(lang, user, subscription) {
  const status = subscription?.status ?? null;

  const rows = [];

  switch (status) {
    case 'active':
      rows.push([Markup.button.callback(t('btn_get_config', lang), 'get_config')]);
      rows.push([Markup.button.callback(t('btn_create_sublink', lang), 'create_sublink')]);
      rows.push([Markup.button.callback(t('btn_my_subscriptions', lang), 'my_subscriptions')]);
      break;

    case 'on_hold':
      rows.push([Markup.button.callback(t('panel_on_hold_message', lang), 'my_subscriptions')]);
      rows.push([Markup.button.callback(t('btn_update_uuid', lang), 'update_uuid')]);
      rows.push([Markup.button.callback(t('btn_my_subscriptions', lang), 'my_subscriptions')]);
      break;

    case 'expired':
      rows.push([Markup.button.callback(t('btn_renew_subscription', lang), 'buy_renew')]);
      rows.push([Markup.button.callback(t('btn_my_subscriptions', lang), 'my_subscriptions')]);
      break;

    case 'suspended':
      rows.push([Markup.button.callback(t('btn_contact_support', lang), 'contact_support')]);
      rows.push([Markup.button.callback(t('btn_my_subscriptions', lang), 'my_subscriptions')]);
      break;

    default:
      rows.push([Markup.button.callback(t('btn_buy_renew', lang), 'buy_renew')]);
      rows.push([Markup.button.callback(t('btn_free_trial', lang), 'free_trial')]);
      break;
  }

  rows.push([Markup.button.callback(t('btn_profile', lang), 'profile')]);
  rows.push([Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')]);
  rows.push(changeLanguageRow());

  return Markup.inlineKeyboard(rows);
}

// ─── Dynamic: client-type picker for "Get Config" ──────────────────────────
/**
 * Asks the user which VPN client they use so we can return the right format.
 * Buttons fire `config_client_<clientKey>_<subscriptionId>`.
 *
 * Clients → User-Agent hint used in SmartSubscriptionService:
 *   v2rayng  → standard Base64 (VLESS/VMess/Trojan URIs)
 *   singbox  → Sing-box JSON
 *   clash    → Clash YAML
 *
 * @param {string} lang
 * @param {string} subscriptionId
 * @returns {Markup}
 */
export function generateClientPickerKeyboard(lang, subscriptionId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t('btn_v2rayng', lang), `config_client_v2rayng_${subscriptionId}`),
      Markup.button.callback(t('btn_singbox', lang), `config_client_singbox_${subscriptionId}`),
    ],
    [
      Markup.button.callback(t('btn_clash', lang), `config_client_clash_${subscriptionId}`),
      Markup.button.callback(t('btn_clashmeta', lang), `config_client_clashmeta_${subscriptionId}`),
    ],
    [Markup.button.callback(t('btn_back', lang), 'my_subscriptions')],
  ]);
}

// ─── Dynamic: broadcast audience picker ────────────────────────────────────
export function generateBroadcastKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('broadcast_all_users', lang), 'admin_broadcast_all')],
    [Markup.button.callback(t('broadcast_active_users', lang), 'admin_broadcast_active')],
    [Markup.button.callback(t('broadcast_onhold_users', lang), 'admin_broadcast_on_hold')],
    [Markup.button.callback(t('broadcast_expired_users', lang), 'admin_broadcast_expired')],
    [Markup.button.callback(t('btn_back', lang), 'admin_back')],
  ]);
}

// ─── Dynamic: plan list ─────────────────────────────────────────────────────
/**
 * @param {string} lang
 * @param {Array<{_id: string, title: string, basePrice: number, isActive: boolean}>} plans
 * @param {function} formatRials  - formatter from utils, takes (amount, lang)
 */
export function generatePlansKeyboard(lang, plans, formatRials) {
  if (!plans || plans.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback(t('no_plans_available', lang), 'buy_renew')],
      [Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')],
    ]);
  }

  const rows = plans.map(p => {
    const statusIcon = p.isActive ? '✅' : '❌';
    return [Markup.button.callback(
      `${statusIcon} ${p.title} — ${formatRials(p.basePrice, lang)}`,
      `select_plan_${p._id}`,
    )];
  });

  rows.push([Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')]);
  return Markup.inlineKeyboard(rows);
}

// ─── Dynamic: language selection ───────────────────────────────────────────
export function generateLanguageKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('btn_lang_en', 'en'), 'set_language_en')],
    [Markup.button.callback(t('btn_lang_fa', 'fa'), 'set_language_fa')],
    [Markup.button.callback(t('btn_lang_ru', 'ru'), 'set_language_ru')],
  ]);
}
