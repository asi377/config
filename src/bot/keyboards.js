/**
 * keyboards.js
 *
 * Single source-of-truth for every Telegraf inline keyboard in the bot.
 *
 * Static keyboards are plain exported constants.
 * Dynamic keyboards are named generator functions: generateXxx(data).
 * All dynamic generators are pure functions — no DB calls, no side-effects.
 */

import { Markup } from 'telegraf';

// ─── Static: main user menu ───────────────────────────────────────────────────
export const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📋 سرویس‌های من',   'my_subscriptions')],
  [Markup.button.callback('🛒 خرید اشتراک',     'buy_renew')],
  [Markup.button.callback('🎁 طرح آزمایشی',     'free_trial')],
  [Markup.button.callback('📊 پروفایل کاربری',  'profile')],
]);

// ─── Static: admin panel ──────────────────────────────────────────────────────
export const adminMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📊 داشبورد',      'admin_dashboard'),
   Markup.button.callback('👤 کاربران',      'admin_users')],
  [Markup.button.callback('🌐 سرورها',        'admin_servers'),
   Markup.button.callback('📦 طرح‌ها',       'admin_plans')],
  [Markup.button.callback('💰 امور مالی',    'admin_finance'),
   Markup.button.callback('📢 پیام همگانی',  'admin_bot')],
  [Markup.button.callback('⚡ پهنای باند',   'admin_bandwidth'),
   Markup.button.callback('🛡️ امنیت',        'admin_security')],
  [Markup.button.callback('📈 آمار',         'admin_analytics'),
   Markup.button.callback('🎫 تیکت‌ها',      'admin_tickets')],
  [Markup.button.callback('💾 پشتیبان',      'admin_backup'),
   Markup.button.callback('📊 آمار سریع',    'admin_metrics')],
  [Markup.button.callback('📋 اشتراک‌ها',    'admin_subscriptions'),
   Markup.button.callback('🧾 رسیدها',       'admin_receipts')],
  [Markup.button.callback('🎟️ کد تخفیف',    'admin_promocodes'),
   Markup.button.callback('⚙️ تنظیمات',      'admin_settings')],
  [Markup.button.callback('🔙 بازگشت به منو', 'main_menu')],
]);

// ─── Static: shared back buttons ─────────────────────────────────────────────
export const adminBackKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 بازگشت به پنل مدیریت', 'admin_back')],
]);

// ─── Static: basic subscription actions ──────────────────────────────────────
export function subscriptionActionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔗 دریافت پیکربندی', 'get_config')],
    [Markup.button.callback('➕ ایجاد لینک جدید',  'create_sublink')],
    [Markup.button.callback('🔙 منوی اصلی',         'main_menu')],
  ]);
}

// ─── Dynamic: server list with health indicators ──────────────────────────────
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
 * @param {Array<{_id: string, name: string, healthStatus: string, loadPercent: number, status: string}>} servers
 * @returns {Markup}
 */
export function generateServersKeyboard(servers) {
  if (!servers || servers.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('⚠️ هیچ سروری موجود نیست', 'admin_servers')],
      [Markup.button.callback('🔙 بازگشت', 'admin_back')],
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

  serverRows.push([Markup.button.callback('🔙 بازگشت به پنل مدیریت', 'admin_back')]);
  return Markup.inlineKeyboard(serverRows);
}

// ─── Dynamic: user subscription panel ────────────────────────────────────────
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
 * @param {object|null} user
 * @param {object|null} subscription  - Most-relevant subscription (or null)
 * @returns {Markup}
 */
export function generateUserPanel(user, subscription) {
  const status = subscription?.status ?? null;

  const rows = [];

  switch (status) {
    case 'active':
      rows.push([Markup.button.callback('🔗 دریافت پیکربندی', 'get_config')]);
      rows.push([Markup.button.callback('➕ ایجاد لینک جدید',  'create_sublink')]);
      rows.push([Markup.button.callback('📋 اشتراک‌های من',    'my_subscriptions')]);
      break;

    case 'on_hold':
      rows.push([Markup.button.callback('⏳ اشتراک شما آماده اتصال است', 'my_subscriptions')]);
      rows.push([Markup.button.callback('🔄 بروز رسانی UUID',             'update_uuid')]);
      rows.push([Markup.button.callback('📋 اشتراک‌های من',               'my_subscriptions')]);
      break;

    case 'expired':
      rows.push([Markup.button.callback('🔄 تمدید اشتراک',   'buy_renew')]);
      rows.push([Markup.button.callback('📋 اشتراک‌های من',   'my_subscriptions')]);
      break;

    case 'suspended':
      rows.push([Markup.button.callback('🆘 تماس با پشتیبانی', 'contact_support')]);
      rows.push([Markup.button.callback('📋 اشتراک‌های من',    'my_subscriptions')]);
      break;

    default:
      rows.push([Markup.button.callback('🛒 خرید اشتراک',    'buy_renew')]);
      rows.push([Markup.button.callback('🎁 طرح آزمایشی',    'free_trial')]);
      break;
  }

  rows.push([Markup.button.callback('📊 پروفایل کاربری', 'profile')]);
  rows.push([Markup.button.callback('🔙 منوی اصلی',      'main_menu')]);

  return Markup.inlineKeyboard(rows);
}

// ─── Dynamic: client-type picker for "Get Config" ────────────────────────────
/**
 * Asks the user which VPN client they use so we can return the right format.
 * Buttons fire `config_client_<clientKey>_<subscriptionId>`.
 *
 * Clients → User-Agent hint used in SmartSubscriptionService:
 *   v2rayng  → standard Base64 (VLESS/VMess/Trojan URIs)
 *   singbox  → Sing-box JSON
 *   clash    → Clash YAML
 *
 * @param {string} subscriptionId
 * @returns {Markup}
 */
export function generateClientPickerKeyboard(subscriptionId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📱 V2RayNG',   `config_client_v2rayng_${subscriptionId}`),
      Markup.button.callback('📦 Sing-Box',  `config_client_singbox_${subscriptionId}`),
    ],
    [
      Markup.button.callback('⚡ Clash',     `config_client_clash_${subscriptionId}`),
      Markup.button.callback('🔄 Clash Meta', `config_client_clashmeta_${subscriptionId}`),
    ],
    [Markup.button.callback('🔙 بازگشت',    'my_subscriptions')],
  ]);
}

// ─── Dynamic: broadcast audience picker ──────────────────────────────────────
export function generateBroadcastKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📢 همه کاربران',     'admin_broadcast_all')],
    [Markup.button.callback('✅ کاربران فعال',     'admin_broadcast_active')],
    [Markup.button.callback('⏳ کاربران on_hold',  'admin_broadcast_on_hold')],
    [Markup.button.callback('⚠️ کاربران منقضی',   'admin_broadcast_expired')],
    [Markup.button.callback('🔙 بازگشت',           'admin_back')],
  ]);
}

// ─── Dynamic: DB-driven main menu (BotConfig.botMenus) ───────────────────────
/**
 * Renders the admin-configurable main menu stored on BotConfig.botMenus.
 * Buttons are grouped by `row` (ascending) and ordered by `order` within a row.
 * Each button's callback_data is its `actionId` — whether that resolves to a
 * built-in bot.action handler or a custom message chain is decided at
 * dispatch time, not here.
 *
 * @param {Array<{actionId: string, text: string, order?: number, row?: number}>} botMenus
 * @returns {Markup}
 */
export function generateDynamicMenuKeyboard(botMenus) {
  if (!botMenus || botMenus.length === 0) return mainMenuKeyboard;

  const rows = new Map();
  for (const item of botMenus) {
    const rowIndex = item.row ?? 0;
    if (!rows.has(rowIndex)) rows.set(rowIndex, []);
    rows.get(rowIndex).push(item);
  }

  const sortedRowIndexes = [...rows.keys()].sort((a, b) => a - b);
  const keyboard = sortedRowIndexes.map((rowIndex) => rows.get(rowIndex)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item) => Markup.button.callback(item.text, item.actionId)));

  return Markup.inlineKeyboard(keyboard);
}

// ─── Dynamic: plan list ───────────────────────────────────────────────────────
/**
 * @param {Array<{_id: string, title: string, basePrice: number, isActive: boolean}>} plans
 * @param {function} formatRials  - formatter from utils
 */
export function generatePlansKeyboard(plans, formatRials) {
  if (!plans || plans.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('❌ هیچ طرحی موجود نیست', 'buy_renew')],
      [Markup.button.callback('🔙 بازگشت', 'main_menu')],
    ]);
  }

  const rows = plans.map(p => {
    const statusIcon = p.isActive ? '✅' : '❌';
    return [Markup.button.callback(
      `${statusIcon} ${p.title} — ${formatRials(p.basePrice)}`,
      `select_plan_${p._id}`,
    )];
  });

  rows.push([Markup.button.callback('🔙 بازگشت', 'main_menu')]);
  return Markup.inlineKeyboard(rows);
}
