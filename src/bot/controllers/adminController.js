import logger from '../../config/logger.js';
import { generateBroadcastKeyboard } from '../keyboards.js';

const ADMIN_ROLE_CHECK = async (ctx) => {
  const Admin = (await import('../../models/Admin.js')).default;
  const admin = await Admin.findOne({ telegramId: String(ctx.from.id) });
  return admin && admin.role === 'superadmin';
};

export async function adminCommand(ctx) {
  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) return ctx.reply('❌ Unauthorized');

  await ctx.reply('Admin Panel:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Dashboard', callback_data: 'admin_dashboard' }],
        [{ text: '👥 Users', callback_data: 'admin_users' }],
        [{ text: '📋 Plans', callback_data: 'admin_plans' }],
        [{ text: '💰 Finance', callback_data: 'admin_finance' }],
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast_menu' }],
      ],
    },
  });
}

export async function handleAdminBack(ctx) {
  await adminCommand(ctx);
}

export async function handleAdminDashboard(ctx) {
  const Transaction = (await import('../../models/Transaction.js')).default;
  const dailyTotal = await Transaction.aggregate([
    { $match: { type: 'payment', status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  await ctx.editMessageText(`📊 Dashboard\n\nDaily Revenue: ${dailyTotal[0]?.total || 0} IRR`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '← Back', callback_data: 'admin_back' }],
      ],
    },
  });
}

export async function handleAdminMetrics(ctx) {
  await ctx.reply('📈 System Metrics');
}

export async function handleAdminUsers(ctx) {
  const User = (await import('../../models/User.js')).default;
  const count = await User.countDocuments();
  await ctx.editMessageText(`👥 Users: ${count}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '← Back', callback_data: 'admin_back' }],
      ],
    },
  });
}

export async function handleAdminUserResetAll(ctx) {
  await ctx.reply('🔄 Resetting all user bandwidth...');
}

export async function handleAdminServers(ctx) {
  const Server = (await import('../../models/Server.js')).default;
  const count = await Server.countDocuments();
  await ctx.editMessageText(`🖥️ Servers: ${count}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '← Back', callback_data: 'admin_back' }],
      ],
    },
  });
}

export async function handleAdminPlans(ctx) {
  const Plan = (await import('../../models/Plan.js')).default;
  const count = await Plan.countDocuments({ isActive: true });
  await ctx.editMessageText(`📋 Active Plans: ${count}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '← Back', callback_data: 'admin_back' }],
      ],
    },
  });
}

export async function handleAdminFinance(ctx) {
  await ctx.editMessageText('💰 Finance', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Daily Sales', callback_data: 'admin_finance_daily' }],
        [{ text: '← Back', callback_data: 'admin_back' }],
      ],
    },
  });
}

export async function handleAdminFinanceDaily(ctx) {
  await ctx.reply('📊 Daily Sales Report');
}

export async function handleAdminBot(ctx) {
  await ctx.reply('🤖 Bot Configuration');
}

export async function handleAdminBandwidth(ctx) {
  await ctx.reply('📊 Bandwidth Usage');
}

export async function handleAdminSecurity(ctx) {
  await ctx.reply('🔒 Security Settings');
}

export async function handleAdminAnalytics(ctx) {
  await ctx.reply('📈 Analytics');
}

export async function handleAdminTickets(ctx) {
  const Ticket = (await import('../../models/Ticket.js')).default;
  const count = await Ticket.countDocuments({ status: 'open' });
  await ctx.reply(`🎫 Open Tickets: ${count}`);
}

export async function handleAdminSubscriptions(ctx) {
  const Subscription = (await import('../../models/Subscription.js')).default;
  const count = await Subscription.countDocuments({ status: 'active' });
  await ctx.reply(`📱 Active Subscriptions: ${count}`);
}

export async function handleAdminReceipts(ctx) {
  const Receipt = (await import('../../models/Receipt.js')).default;
  const count = await Receipt.countDocuments({ status: 'pending' });
  await ctx.reply(`📄 Pending Receipts: ${count}`);
}

export async function handleAdminPromoCodes(ctx) {
  const PromoCode = (await import('../../models/PromoCode.js')).default;
  const count = await PromoCode.countDocuments();
  await ctx.reply(`🎟️ Promo Codes: ${count}`);
}

export async function handleAdminSettings(ctx) {
  await ctx.reply('⚙️ Admin Settings');
}

export async function handleAdminBackup(ctx) {
  await ctx.reply('💾 Database Backup');
}

export async function handleAdminAddPromo(ctx) {
  await ctx.reply('➕ Add Promo Code');
}

export async function handleAdminBroadcastMenu(ctx) {
  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) return ctx.reply('❌ Unauthorized');

  await ctx.editMessageText('📢 Choose broadcast audience:', generateBroadcastKeyboard());
}

export async function handleAdminBroadcast(ctx) {
  const isAdmin = await ADMIN_ROLE_CHECK(ctx);
  if (!isAdmin) return ctx.reply('❌ Unauthorized');

  const targetRole = ctx.match[1];
  ctx.session.awaitingBroadcast = targetRole;
  await ctx.editMessageText(`📢 Send the message text to broadcast to: ${targetRole}`);
}

export async function handleAdminPlanToggle(ctx) {
  const planId = ctx.match[1];
  await ctx.reply(`🔄 Toggling plan ${planId}`);
}

export async function handleAdminServerDetail(ctx) {
  const serverId = ctx.match[1];
  await ctx.reply(`🖥️ Server: ${serverId}`);
}

export async function handleReceiptAction(ctx) {
  const action = ctx.match[1];
  const receiptId = ctx.match[2];
  await ctx.reply(`${action === 'approve' ? '✅' : '❌'} Receipt ${receiptId}`);
}

export async function handleBroadcastText(ctx) {
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

  await ctx.reply(`✅ Broadcast queued for audience: ${targetRole}`);
  return true;
}
