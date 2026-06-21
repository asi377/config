import { Markup } from 'telegraf';

export const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📋 سرویس‌های من', 'my_subscriptions')],
  [Markup.button.callback('🛒 خرید طرح', 'buy_renew')],
  [Markup.button.callback('🎁 طرح آزمایشی', 'free_trial')],
  [Markup.button.callback('📊 پروفایل کاربری', 'profile')],
]);

export const adminMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📊 داشبورد', 'admin_dashboard'),
   Markup.button.callback('👤 کاربران', 'admin_users')],
  [Markup.button.callback('🌐 سرورها', 'admin_servers'),
   Markup.button.callback('📦 طرح‌ها', 'admin_plans')],
  [Markup.button.callback('💰 امور مالی', 'admin_finance'),
   Markup.button.callback('📢 پیام همگانی', 'admin_bot')],
  [Markup.button.callback('⚡ پهنای باند', 'admin_bandwidth'),
   Markup.button.callback('🛡️ امنیت', 'admin_security')],
  [Markup.button.callback('📈 تحلیل و آمار', 'admin_analytics'),
   Markup.button.callback('🎫 تیکت‌ها', 'admin_tickets')],
  [Markup.button.callback('💾 پشتیبان‌گیری', 'admin_backup'),
   Markup.button.callback('📊 آمار سریع', 'admin_metrics')],
  [Markup.button.callback('📋 اشتراک‌ها', 'admin_subscriptions'),
   Markup.button.callback('🧾 رسیدها', 'admin_receipts')],
  [Markup.button.callback('🎟️ کد تخفیف', 'admin_promocodes'),
   Markup.button.callback('⚙️ تنظیمات', 'admin_settings')],
  [Markup.button.callback('🔙 بازگشت به منوی اصلی', 'main_menu')],
]);

export const adminBackKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 بازگشت به پنل مدیریت', 'admin_back')],
]);

export function subscriptionActionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ ایجاد لینک جدید', 'create_sublink')],
    [Markup.button.callback('🔙 منوی اصلی', 'main_menu')],
  ]);
}
