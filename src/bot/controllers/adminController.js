import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';
import { formatRials } from '../utils.js';
import { generateBroadcastKeyboard, adminMenuKeyboard, adminBackKeyboard } from '../keyboards.js';

const ADMIN_ROLE_CHECK = async (ctx) => {
  const Admin = (await import('../../models/Admin.js')).default;
  const admin = await Admin.findOne({ telegramId: String(ctx.from.id) });
  return admin && admin.role === 'superadmin';
};

export async function adminCommand(ctx) {
  const lang = ctx.lang || 'fa';
  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) return ctx.reply(t('unauthorized', lang));

  await ctx.reply(t('admin_panel_title', lang), {
    reply_markup: adminMenuKeyboard(lang).reply_markup,
  });
}

export async function handleAdminBack(ctx) {
  await adminCommand(ctx);
}

export async function handleAdminDashboard(ctx) {
  const lang = ctx.lang || 'fa';
  const Transaction = (await import('../../models/Transaction.js')).default;
  const dailyTotal = await Transaction.aggregate([
    { $match: { type: 'payment', status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  await ctx.editMessageText(
    t('admin_dashboard_title', lang, { revenue: formatRials(dailyTotal[0]?.total || 0, lang) }),
    { reply_markup: adminBackKeyboard(lang).reply_markup },
  );
}

export async function handleAdminMetrics(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_metrics_title', lang));
}

export async function handleAdminUsers(ctx) {
  const lang = ctx.lang || 'fa';
  const User = (await import('../../models/User.js')).default;
  const count = await User.countDocuments();
  await ctx.editMessageText(t('admin_users_count', lang, { count }), {
    reply_markup: adminBackKeyboard(lang).reply_markup,
  });
}

export async function handleAdminUserResetAll(ctx) {
  const lang = ctx.lang || 'fa';
  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) return ctx.reply(t('unauthorized', lang));

  await ctx.reply(t('admin_user_reset_all_progress', lang));
  const User = (await import('../../models/User.js')).default;
  const result = await User.updateMany({}, { $set: { freeTrialClaimedAt: null } });
  await ctx.reply(t('admin_user_reset_all_done', lang, { count: result.modifiedCount }));
}

export async function handleAdminServers(ctx) {
  const lang = ctx.lang || 'fa';
  const Server = (await import('../../models/Server.js')).default;
  const count = await Server.countDocuments();
  await ctx.editMessageText(t('admin_servers_count', lang, { count }), {
    reply_markup: adminBackKeyboard(lang).reply_markup,
  });
}

export async function handleAdminPlans(ctx) {
  const lang = ctx.lang || 'fa';
  const Plan = (await import('../../models/Plan.js')).default;
  const count = await Plan.countDocuments({ isActive: true });
  await ctx.editMessageText(t('admin_plans_active_count', lang, { count }), {
    reply_markup: adminBackKeyboard(lang).reply_markup,
  });
}

export async function handleAdminFinance(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.editMessageText(t('admin_finance_title', lang), {
    reply_markup: {
      inline_keyboard: [
        [{ text: t('admin_finance_daily_sales', lang), callback_data: 'admin_finance_daily' }],
        [{ text: t('btn_back', lang), callback_data: 'admin_back' }],
      ],
    },
  });
}

export async function handleAdminFinanceDaily(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_finance_daily_report', lang));
}

export async function handleAdminBot(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_bot_config_title', lang));
}

export async function handleAdminBandwidth(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_bandwidth_usage', lang));
}

export async function handleAdminSecurity(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_security_settings', lang));
}

export async function handleAdminAnalytics(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_analytics_title', lang));
}

export async function handleAdminTickets(ctx) {
  const lang = ctx.lang || 'fa';
  const Ticket = (await import('../../models/Ticket.js')).default;
  const count = await Ticket.countDocuments({ status: 'open' });
  await ctx.reply(t('admin_tickets_open_count', lang, { count }));
}

export async function handleAdminSubscriptions(ctx) {
  const lang = ctx.lang || 'fa';
  const Subscription = (await import('../../models/Subscription.js')).default;
  const count = await Subscription.countDocuments({ status: 'active' });
  await ctx.reply(t('admin_subscriptions_active_count', lang, { count }));
}

export async function handleAdminReceipts(ctx) {
  const lang = ctx.lang || 'fa';
  const Receipt = (await import('../../models/Receipt.js')).default;
  const count = await Receipt.countDocuments({ status: 'pending' });
  await ctx.reply(t('admin_receipts_pending_count', lang, { count }));
}

export async function handleAdminPromoCodes(ctx) {
  const lang = ctx.lang || 'fa';
  const PromoCode = (await import('../../models/PromoCode.js')).default;
  const count = await PromoCode.countDocuments();
  await ctx.reply(t('admin_promocodes_count', lang, { count }));
}

export async function handleAdminSettings(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_settings_title', lang));
}

export async function handleAdminBackup(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_backup_title', lang));
}

export async function handleAdminAddPromo(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('admin_add_promo_title', lang));
}

export async function handleAdminBroadcastMenu(ctx) {
  const lang = ctx.lang || 'fa';
  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) return ctx.reply(t('unauthorized', lang));

  await ctx.editMessageText(t('admin_broadcast_choose_audience', lang), generateBroadcastKeyboard(lang));
}

export async function handleAdminBroadcast(ctx) {
  const lang = ctx.lang || 'fa';
  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) return ctx.reply(t('unauthorized', lang));

  const targetRole = ctx.match[1];
  ctx.session.awaitingBroadcast = targetRole;
  await ctx.editMessageText(t('admin_broadcast_enter_text', lang, { targetRole }));
}

export async function handleAdminPlanToggle(ctx) {
  const lang = ctx.lang || 'fa';
  const planId = ctx.match[1];
  await ctx.reply(t('admin_plan_toggling', lang, { planId }));
}

export async function handleAdminServerDetail(ctx) {
  const lang = ctx.lang || 'fa';
  const serverId = ctx.match[1];
  await ctx.reply(t('admin_server_detail', lang, { serverId }));
}

export async function handleReceiptAction(ctx) {
  const lang = ctx.lang || 'fa';
  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) return ctx.reply(t('unauthorized', lang));

  const action = ctx.match[1] === 'approve' ? 'approve' : 'reject';
  const receiptId = ctx.match[2];
  const key = action === 'approve' ? 'admin_receipt_approved' : 'admin_receipt_rejected';

  try {
    const Admin = (await import('../../models/Admin.js')).default;
    const PaymentService = (await import('../../services/PaymentService.js')).default;
    const admin = await Admin.findOne({ telegramId: String(ctx.from.id) });

    const result = await PaymentService.processReceipt(receiptId, admin?._id || null, action);
    await ctx.reply(t(key, lang, { receiptId }));

    if (action === 'approve' && result.user?.telegramId) {
      await PaymentService._notifyUserOfDelivery(ctx.telegram, result);
    }
  } catch (err) {
    logger.error({ err, receiptId, action }, '[admin] receipt action failed');
    await ctx.reply(t('admin_receipt_action_failed', lang, { receiptId }));
  }
}

export async function handleBroadcastText(ctx) {
  const lang = ctx.lang || 'fa';
  const targetRole = ctx.session?.awaitingBroadcast;
  if (!targetRole) return false;

  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) {
    delete ctx.session.awaitingBroadcast;
    return false;
  }

  delete ctx.session.awaitingBroadcast;

  const BullMQManager = (await import('../../queue/bullmq.js')).default;
  await BullMQManager.enqueue('telegram-out', 'broadcast', { text: ctx.message.text, targetRole });

  await ctx.reply(t('admin_broadcast_queued', lang, { targetRole }));
  return true;
}
