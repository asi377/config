/**
 * adminController.js  — fully separated from userController
 *
 * New in this version:
 *  - generateServersKeyboard for live health status
 *  - admin_server_detail_<id> handler
 *  - BullMQ-backed broadcast via BroadcastService
 *  - generateBroadcastKeyboard with on_hold audience
 */

import UserService from '../../services/UserService.js';
import AdminService from '../../services/admin/AdminService.js';
import AdminDashboardService from '../../services/admin/AdminDashboardService.js';
import AdminServerService from '../../services/admin/AdminServerService.js';
import BroadcastService from '../../services/admin/BroadcastService.js';
import Subscription from '../../models/Subscription.js';
import User from '../../models/User.js';
import Ticket from '../../models/Ticket.js';
import Server from '../../models/Server.js';
import Plan from '../../models/Plan.js';
import Receipt from '../../models/Receipt.js';
import PromoCode from '../../models/PromoCode.js';
import Setting from '../../models/Setting.js';
import { Markup } from 'telegraf';
import { hasRole } from '../../utils/rbac.js';
import { formatRials, formatDate } from '../utils.js';
import {
  adminMenuKeyboard,
  adminBackKeyboard,
  generateServersKeyboard,
  generateBroadcastKeyboard,
} from '../keyboards.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err?.description?.includes('message is not modified')) return;
    throw err;
  }
}

const backKeyboard = adminBackKeyboard;

// ─── /admin command ───────────────────────────────────────────────────────────

export async function adminCommand(ctx) {
  const user = await UserService.resolveUser(ctx.from.id);
  if (!hasRole(user.role, ['support', 'superadmin'])) {
    await ctx.reply('🚫 شما دسترسی به پنل مدیریت ندارید.');
    return;
  }
  ctx.user = user;
  await ctx.replyWithMarkdown('📊 *پنل مدیریت HORNET*\n\nبخش مورد نظر را انتخاب کنید:', adminMenuKeyboard);
}

export async function handleAdminBack(ctx) {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '📊 *پنل مدیریت HORNET*\n\nبخش مورد نظر را انتخاب کنید:', {
    parse_mode: 'Markdown', ...adminMenuKeyboard,
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function handleAdminDashboard(ctx) {
  await ctx.answerCbQuery();
  try {
    const dash = await AdminDashboardService.getDashboard();
    const nearCapacity = await Server.countDocuments({
      status: 'active',
      $expr: { $gte: [{ $divide: ['$currentActiveUsers', '$maxCapacity'] }, 0.8] },
    });
    const lines = [
      '📊 *پنل مدیریت HORNET*', '━━━━━━━━━━━━━━━━━━━━', '',
      `💰 درآمد امروز: ${formatRials(dash.todayRevenue)}`,
      `🔹 کل کاربران: \`${dash.totalUsers}\``,
      `✅ کاربران فعال: \`${dash.activeSubscriptions}\``,
      `📊 ترافیک امروز: \`${dash.todayBandwidthGB}\` GB`,
      `✅ سرورهای سالم: \`${dash.serverHealthy}\`/\`${dash.serverTotal}\``,
      `⚠️ نزدیک ظرفیت: \`${nearCapacity}\``,
    ];
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📊 آمار', 'admin_metrics'), Markup.button.callback('🌐 سرورها', 'admin_servers')],
        [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
      ]),
    });
  } catch { await safeEdit(ctx, '❌ خطا در دریافت داشبورد.', backKeyboard); }
}

export async function handleAdminMetrics(ctx) {
  await ctx.answerCbQuery();
  try {
    const metrics = await AdminService.getGlobalMetrics();
    await safeEdit(ctx, [
      '📊 *آمار سریع*', '',
      `🔹 کل کاربران: \`${metrics.totalUsers}\``,
      `✅ کاربران فعال: \`${metrics.activeSubscriptions}\``,
      `📊 ترافیک مصرفی: \`${metrics.totalBandwidthGB}\` GB`,
      `💰 درآمد ماهانه: ${formatRials(metrics.monthlyRevenue)}`,
    ].join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا در دریافت آمار.', backKeyboard); }
}

// ─── Servers — dynamic keyboard ───────────────────────────────────────────────

export async function handleAdminServers(ctx) {
  await ctx.answerCbQuery();
  try {
    const servers = await AdminServerService.getAllServers();
    await safeEdit(ctx, '🌐 *مدیریت سرورها*\n\nیک سرور را انتخاب کنید:', {
      parse_mode: 'Markdown',
      ...generateServersKeyboard(servers),
    });
  } catch { await safeEdit(ctx, '❌ خطا در دریافت سرورها.', backKeyboard); }
}

export async function handleAdminServerDetail(ctx) {
  await ctx.answerCbQuery();
  const serverId = ctx.match[1];
  try {
    const server = await Server.findById(serverId).lean();
    if (!server) { await safeEdit(ctx, '❌ سرور یافت نشد.', backKeyboard); return; }

    const healthEmoji = { healthy: '🟢', degraded: '🟡', unhealthy: '🔴', unknown: '⚪' };
    const statusEmoji = server.status === 'active' ? '✅' : server.status === 'offline' ? '⚫' : '🔧';
    const loadPct = server.maxCapacity > 0
      ? ((server.currentActiveUsers / server.maxCapacity) * 100).toFixed(1)
      : '100.0';
    const bar = '▰'.repeat(Math.min(10, Math.floor(Number(loadPct) / 10)))
              + '▱'.repeat(Math.max(0, 10 - Math.floor(Number(loadPct) / 10)));

    const lines = [
      `${statusEmoji} *${server.name}*`, '',
      `🌍 منطقه: \`${server.region || '—'}\``,
      `🌐 IP: \`${server.ipAddress}\``,
      `📡 پورت: \`${server.port}\``,
      `🔋 بار: ${bar} \`${loadPct}%\``,
      `👥 کاربران: \`${server.currentActiveUsers}\`/\`${server.maxCapacity}\``,
      `💓 سلامت: ${healthEmoji[server.healthStatus] || '⚪'} \`${server.healthStatus || 'unknown'}\``,
      `💾 coefficient: \`${server.coefficient ?? 1.0}\``,
      `⏱ آخرین heartbeat: ${server.lastHeartbeat ? formatDate(new Date(server.lastHeartbeat)) : '—'}`,
    ];

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 بازگشت به سرورها', 'admin_servers')],
      ]),
    });
  } catch { await safeEdit(ctx, '❌ خطا در دریافت اطلاعات سرور.', backKeyboard); }
}

// ─── Users ─────────────────────────────────────────────────────────────────────

export async function handleAdminUsers(ctx) {
  await ctx.answerCbQuery();
  try {
    const totalUsers = await User.countDocuments();
    const activeSubs = await Subscription.countDocuments({ status: 'active' });
    const bannedUsers = await User.countDocuments({ role: 'banned' });
    const lines = [
      '👤 *مدیریت کاربران*', '',
      `🔹 کل کاربران: \`${totalUsers}\``,
      `✅ اشتراک فعال: \`${activeSubs}\``,
      `🚫 بن شده: \`${bannedUsers}\``,
      '',
      'برای جستجوی کاربر از پنل وب استفاده کنید.',
    ];
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 ریست مصرف همه', 'admin_user_reset_all')],
        [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
      ]),
    });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminUserResetAll(ctx) {
  await ctx.answerCbQuery();
  try {
    const result = await Subscription.updateMany(
      { status: 'active' },
      { $set: { usedVolumeBytes: 0 } },
    );
    await safeEdit(ctx, `✅ مصرف ${result.modifiedCount} کاربر فعال ریست شد.`, {
      parse_mode: 'Markdown', ...backKeyboard,
    });
  } catch { await safeEdit(ctx, '❌ خطا در ریست مصرف.', backKeyboard); }
}

// ─── Plans ─────────────────────────────────────────────────────────────────────

export async function handleAdminPlans(ctx) {
  await ctx.answerCbQuery();
  try {
    const plans = await Plan.find({ isArchived: { $ne: true } }).sort({ sortOrder: 1, basePrice: 1 });
    const lines = ['📦 *طرح‌ها*', ''];
    for (const p of plans) {
      const statusIcon = p.isActive ? '✅' : '❌';
      const vol = p.baseVolumeGB > 0 ? `${p.baseVolumeGB} GB` : '♾';
      lines.push(`${statusIcon} *${p.title}* — ${p.basePrice.toLocaleString()} ریال / ${vol}`);
      lines.push(`   دسته: ${p.category} | مدت: ${p.durationDays} روز | لینک: ${p.maxSubLinks}`);
      lines.push(`   /plan_toggle_${p._id}`);
    }
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown', ...backKeyboard,
    });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminPlanToggle(ctx) {
  await ctx.answerCbQuery();
  try {
    const planId = ctx.match[1];
    const plan = await Plan.findById(planId);
    if (!plan) { await safeEdit(ctx, '❌ طرح یافت نشد.', backKeyboard); return; }
    plan.isActive = !plan.isActive;
    await plan.save();
    await safeEdit(ctx, `✅ وضعیت طرح '${plan.title}' به ${plan.isActive ? 'فعال' : 'غیرفعال'} تغییر کرد.`, {
      parse_mode: 'Markdown', ...backKeyboard,
    });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Finance ───────────────────────────────────────────────────────────────────

export async function handleAdminFinance(ctx) {
  await ctx.answerCbQuery();
  try {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const subsThisMonth = await Subscription.find({ createdAt: { $gte: startOfMonth } }).populate('planId');
    let revenue = 0;
    let count = 0;
    for (const s of subsThisMonth) {
      if (s.planId && s.status !== 'pending_shared_payment') {
        revenue += s.planId.basePrice || 0;
        count++;
      }
    }
    const lines = [
      '💰 *مدیریت مالی*', '',
      '📅 ماه جاری:',
      `   🔹 فروش: ${count} اشتراک`,
      `   💰 درآمد: ${revenue.toLocaleString()} ریال`,
    ];
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📊 فروش روزانه', 'admin_finance_daily')],
        [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
      ]),
    });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminFinanceDaily(ctx) {
  await ctx.answerCbQuery();
  try {
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(start.getTime() + 86400000);
      const subs = await Subscription.find({ createdAt: { $gte: start, $lt: end } }).populate('planId');
      let rev = 0;
      for (const s of subs) {
        if (s.planId && s.status !== 'pending_shared_payment') rev += s.planId.basePrice || 0;
      }
      last7.push({ date: start.toLocaleDateString('fa-IR'), revenue: rev });
    }
    const lines = ['📊 *فروش ۷ روز گذشته*', ''];
    for (const d of last7) {
      lines.push(`${d.date}: ${d.revenue.toLocaleString()} ریال`);
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Broadcast ─────────────────────────────────────────────────────────────────

export async function handleAdminBot(ctx) {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '📢 *پیام همگانی*\n\nگروه مخاطبان را انتخاب کنید:', {
    parse_mode: 'Markdown', ...generateBroadcastKeyboard(),
  });
}

export async function handleAdminBroadcast(ctx) {
  await ctx.answerCbQuery();
  try {
    const audience = ctx.match[1];
    const result = await BroadcastService.enqueueBroadcast(audience, ctx.session?.broadcastText || 'پیام آزمایشی');
    const audienceNames = { all: 'همه', active: 'فعال', on_hold: 'در انتظار', expired: 'منقضی' };
    await safeEdit(ctx, `✅ پیام برای ${audienceNames[audience] || audience} ارسال شد.\nتعداد: ${result.enqueued}`, {
      parse_mode: 'Markdown', ...backKeyboard,
    });
  } catch (err) {
    await safeEdit(ctx, `❌ خطا: ${err.message}`, backKeyboard);
  }
}

// ─── Bandwidth ─────────────────────────────────────────────────────────────────

export async function handleAdminBandwidth(ctx) {
  await ctx.answerCbQuery();
  try {
    const servers = await Server.find({ status: 'active' });
    const lines = ['⚡ *مدیریت پهنای باند*', ''];
    for (const s of servers) {
      const loadPct = s.maxCapacity > 0 ? ((s.currentActiveUsers / s.maxCapacity) * 100).toFixed(1) : 'N/A';
      const bar = '▰'.repeat(Math.min(10, Math.floor(Number(loadPct) / 10)))
                + '▱'.repeat(Math.max(0, 10 - Math.floor(Number(loadPct) / 10)));
      lines.push(`*${s.name}*`);
      lines.push(`   بار: ${bar} ${loadPct}%`);
      lines.push(`   کاربران: ${s.currentActiveUsers}/${s.maxCapacity}`);
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Security ──────────────────────────────────────────────────────────────────

export async function handleAdminSecurity(ctx) {
  await ctx.answerCbQuery();
  const lines = [
    '🛡️ *امنیت*', '',
    '🔹 رمزنگاری: AES-256-GCM',
    '🔹 احراز هویت: JWT + mTLS + HMAC',
    '🔹 حفاظت: Nonce replay protection',
    '🔹 Rate limit: فعال',
    '🔹 CORS: پیکربندی شده',
    '🔹 Helmet: فعال (CSP, HSTS, XSS)',
    '',
    'وضعیت امنیتی: ✅ مطلوب',
  ];
  await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
}

// ─── Analytics ─────────────────────────────────────────────────────────────────

export async function handleAdminAnalytics(ctx) {
  await ctx.answerCbQuery();
  try {
    const totalUsers = await User.countDocuments();
    const activeSubs = await Subscription.countDocuments({ status: 'active' });
    const expiredSubs = await Subscription.countDocuments({ status: 'expired' });
    const totalBW = await Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, total: { $sum: '$usedVolumeBytes' } } },
    ]);
    const bwGB = totalBW[0] ? (totalBW[0].total / 1073741824).toFixed(2) : '0';
    const lines = [
      '📈 *آمار تحلیلی*', '',
      `👤 کل کاربران: \`${totalUsers}\``,
      `✅ فعال: \`${activeSubs}\``,
      `⚠️ منقضی: \`${expiredSubs}\``,
      `📊 ترافیک مصرفی: \`${bwGB}\` GB`,
    ];
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Tickets ───────────────────────────────────────────────────────────────────

export async function handleAdminTickets(ctx) {
  await ctx.answerCbQuery();
  try {
    const tickets = await Ticket.find().sort({ createdAt: -1 }).limit(10).populate('userId', 'telegramId');
    const lines = ['🎫 *تیکت‌ها*', ''];
    if (tickets.length === 0) {
      lines.push('هیچ تیکتی وجود ندارد.');
    } else {
      for (const t of tickets) {
        const statusIcon = t.status === 'open' ? '🟢' : t.status === 'answered' ? '🟡' : '🔴';
        lines.push(`${statusIcon} از \`${t.userId?.telegramId || '—'}\`: ${(t.messages?.[0]?.text || '...').slice(0, 40)}`);
      }
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Subscriptions ─────────────────────────────────────────────────────────────

export async function handleAdminSubscriptions(ctx) {
  await ctx.answerCbQuery();
  try {
    const subs = await Subscription.find().sort({ createdAt: -1 }).limit(10).populate('planId').populate('ownerId', 'telegramId');
    const lines = ['📋 *اشتراک‌ها (آخرین ۱۰)*', ''];
    for (const s of subs) {
      const statusIcon = s.status === 'active' ? '✅' : s.status === 'expired' ? '⚠️' : '❌';
      lines.push(`${statusIcon} \`${s.ownerId?.telegramId || '—'}\` — ${s.planId?.title || '—'} (${s.status})`);
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Receipts ──────────────────────────────────────────────────────────────────

export async function handleAdminReceipts(ctx) {
  await ctx.answerCbQuery();
  try {
    const receipts = await Receipt.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10).populate('userId', 'telegramId');
    const lines = ['🧾 *رسیدهای در انتظار تأیید*', ''];
    if (receipts.length === 0) {
      lines.push('هیچ رسید در انتظاری وجود ندارد.');
    } else {
      for (const r of receipts) {
        lines.push(`🔹 از \`${r.userId?.telegramId || '—'}\` — ${(r.amount || 0).toLocaleString()} ریال`);
        lines.push(`   ID: \`${r._id}\``);
      }
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleReceiptAction(ctx) {
  await ctx.answerCbQuery();
  try {
    const action = ctx.match[1];
    const receiptId = ctx.match[2];
    const receipt = await Receipt.findById(receiptId);
    if (!receipt) { await safeEdit(ctx, '❌ رسید یافت نشد.', backKeyboard); return; }

    if (action === 'approve') {
      receipt.status = 'approved';
      await receipt.save();
      await safeEdit(ctx, `✅ رسید ${receiptId} تأیید شد.`, backKeyboard);
    } else {
      receipt.status = 'rejected';
      await receipt.save();
      await safeEdit(ctx, `❌ رسید ${receiptId} رد شد.`, backKeyboard);
    }
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Promo Codes ───────────────────────────────────────────────────────────────

export async function handleAdminPromoCodes(ctx) {
  await ctx.answerCbQuery();
  try {
    const codes = await PromoCode.find().sort({ createdAt: -1 }).limit(10);
    const lines = ['🎟️ *کدهای تخفیف*', ''];
    if (codes.length === 0) {
      lines.push('هیچ کد تخفیفی وجود ندارد.');
    } else {
      for (const c of codes) {
        const active = c.isActive ? '✅' : '❌';
        const usage = c.usageLimit ? `${c.usedCount}/${c.usageLimit}` : '♾';
        lines.push(`${active} \`${c.code}\` — ${c.discountPercent || 0}% تخفیف (مصرف: ${usage})`);
      }
    }
    lines.push('', 'برای افزودن کد جدید از پنل وب استفاده کنید.');
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminAddPromo(ctx) {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '🎟️ برای افزودن کد تخفیف از پنل وب استفاده کنید.', { parse_mode: 'Markdown', ...backKeyboard });
}

// ─── Settings ──────────────────────────────────────────────────────────────────

export async function handleAdminSettings(ctx) {
  await ctx.answerCbQuery();
  try {
    const settings = await Setting.find().sort({ group: 1, sortOrder: 1, key: 1 }).limit(20);
    const lines = ['⚙️ *تنظیمات*', ''];
    let currentGroup = '';
    for (const s of settings) {
      if (s.group !== currentGroup) {
        currentGroup = s.group;
        lines.push(`📁 *${s.group}*`);
      }
      const val = s.isSecret ? '••••••••' : String(s.value ?? '').slice(0, 30);
      lines.push(`   \`${s.key}\`: ${val}`);
    }
    lines.push('', 'برای ویرایش از پنل وب استفاده کنید.');
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Backup ────────────────────────────────────────────────────────────────────

export async function handleAdminBackup(ctx) {
  await ctx.answerCbQuery();
  try {
    const { default: AdminService } = await import('../../services/admin/AdminService.js');
    const backupPath = await AdminService.generateDatabaseBackup();
    await safeEdit(ctx, `💾 *پشتیبان‌گیری*\n\nفایل پشتیبان در:\n\`${backupPath}\`\n\nایجاد شد.`, {
      parse_mode: 'Markdown', ...backKeyboard,
    });
  } catch { await safeEdit(ctx, '❌ خطا در پشتیبان‌گیری.', backKeyboard); }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function handleAdminUsers(ctx) {
  await ctx.answerCbQuery();
  try {
    const total     = await User.countDocuments();
    const banned    = await User.countDocuments({ role: 'banned' });
    const active    = await Subscription.countDocuments({ status: 'active' });
    const onHold    = await Subscription.countDocuments({ status: 'on_hold' });
    const lines = [
      '👤 *مدیریت کاربران*', '',
      `🔹 کل کاربران: \`${total}\``,
      `✅ اشتراک فعال: \`${active}\``,
      `⏳ در انتظار اتصال: \`${onHold}\``,
      `🚫 مسدود: \`${banned}\``,
    ];
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 ریست ترافیک همه', 'admin_user_reset_all')],
        [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
      ]),
    });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminUserResetAll(ctx) {
  await ctx.answerCbQuery();
  const res = await Subscription.updateMany({ status: 'active' }, { $set: { usedVolumeBytes: 0 } });
  await safeEdit(ctx, `✅ ترافیک \`${res.modifiedCount}\` کاربر ریست شد.`,
    { parse_mode: 'Markdown', ...backKeyboard });
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function handleAdminPlans(ctx) {
  await ctx.answerCbQuery();
  try {
    const plans = await AdminPlanService.getAllPlans();
    if (!plans.length) { await safeEdit(ctx, '📦 هیچ طرحی یافت نشد.', backKeyboard); return; }
    const rows = plans.map(p => [
      Markup.button.callback(
        `${p.isActive ? '✅' : '❌'} ${p.title} — ${formatRials(p.basePrice)}`,
        `admin_plan_toggle_${p._id}`,
      ),
    ]);
    rows.push([Markup.button.callback('🔙 پنل مدیریت', 'admin_back')]);
    await safeEdit(ctx, '📦 *مدیریت طرح‌ها*\n\nروی طرح کلیک کنید تا وضعیت تغییر کند:', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rows),
    });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminPlanToggle(ctx) {
  await ctx.answerCbQuery();
  const planId = ctx.match[1];
  try {
    const plan = await Plan.findById(planId).lean();
    if (!plan) { await safeEdit(ctx, '❌ طرح یافت نشد.', backKeyboard); return; }
    await Plan.findByIdAndUpdate(planId, { $set: { isActive: !plan.isActive } });
    await safeEdit(ctx,
      `✅ طرح \`${plan.title}\` → ${!plan.isActive ? '✅ فعال' : '❌ غیرفعال'} شد.`,
      { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export async function handleAdminFinance(ctx) {
  await ctx.answerCbQuery();
  try {
    const now     = new Date();
    const monthly = await AdminFinanceService.getMonthlySales(now.getFullYear(), now.getMonth() + 1);
    const daily   = await AdminFinanceService.getDailySales(1);
    const proj    = await AdminFinanceService.getRevenueProjection();
    const lines   = [
      '💰 *امور مالی*', '',
      `💰 درآمد امروز: ${formatRials(daily[0]?.revenue || 0)} (\`${daily[0]?.count || 0}\` تراکنش)`,
      `📊 درآمد ماهانه: ${formatRials(monthly.totalRevenue)} (\`${monthly.totalSales}\` تراکنش)`,
      `📈 پیش‌بینی ۳ ماهه: ${formatRials(proj.projection3Months)}`,
    ];
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📅 فروش ۷ روز', 'admin_finance_daily')],
        [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
      ]),
    });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminFinanceDaily(ctx) {
  await ctx.answerCbQuery();
  try {
    const daily = await AdminFinanceService.getDailySales(7);
    const lines = ['📅 *فروش ۷ روز اخیر*', ''];
    for (const d of daily) lines.push(`🔹 ${d._id} : ${formatRials(d.revenue)} (\`${d.count}\` فروش)`);
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

// ─── Broadcast — BullMQ backed ────────────────────────────────────────────────

export async function handleAdminBot(ctx) {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '📢 *پیام همگانی*\n\nمخاطبان را انتخاب کنید:', {
    parse_mode: 'Markdown',
    ...generateBroadcastKeyboard(),
  });
}

/**
 * Triggered by admin_broadcast_<audience>
 * Enqueues messages via BroadcastService → BullMQ → rate-limited worker.
 */
export async function handleAdminBroadcast(ctx) {
  await ctx.answerCbQuery();
  const audience = ctx.match[1]; // all | active | on_hold | expired

  // We need the message text from the admin — store intent in session
  ctx.session = ctx.session || {};
  ctx.session.broadcastAudience = audience;

  const labels = {
    all:      'همه کاربران',
    active:   'کاربران فعال',
    on_hold:  'کاربران در انتظار اتصال',
    expired:  'کاربران منقضی',
  };

  await safeEdit(ctx, [
    '📢 *ارسال پیام همگانی*', '',
    `مخاطب: *${labels[audience] || audience}*`, '',
    'متن پیام خود را ارسال کنید:',
    '_(برای لغو دکمه بازگشت را بزنید)_',
  ].join('\n'), {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 لغو', 'admin_bot')]]),
  });
}

/**
 * Called when admin sends a text message while broadcastAudience is set in session.
 * This handler must be wired in index.js as bot.on('text', adminController.handleBroadcastText).
 */
export async function handleBroadcastText(ctx) {
  if (!ctx.session?.broadcastAudience) return false; // not our message
  const audience = ctx.session.broadcastAudience;
  delete ctx.session.broadcastAudience;

  const text = ctx.message?.text;
  if (!text) return false;

  try {
    const result = await BroadcastService.enqueueBroadcast(audience, text, 'Markdown');
    await ctx.replyWithMarkdown(
      `✅ *پیام در صف ارسال قرار گرفت*\n\n📨 تعداد: \`${result.enqueued}\` کاربر\n\nارسال در پس‌زمینه انجام می‌شود.`,
      backKeyboard,
    );
  } catch (err) {
    await ctx.reply(`❌ خطا در صف‌گذاری: ${err.message}`);
  }
  return true;
}

// ─── Bandwidth / Analytics / Security / Tickets / Receipts / Promos ──────────

export async function handleAdminBandwidth(ctx) {
  await ctx.answerCbQuery();
  try {
    const actions  = await AdminBandwidthService.getLoadAwareScalingActions();
    const servers  = await Server.find({ status: 'active' }).lean();
    const lines    = ['⚡ *مدیریت پهنای باند*', ''];
    for (const s of servers) {
      const pct = s.maxCapacity > 0 ? ((s.currentActiveUsers / s.maxCapacity) * 100).toFixed(1) : '100.0';
      const bar = '▰'.repeat(Math.min(10, Math.floor(Number(pct) / 10))) + '▱'.repeat(Math.max(0, 10 - Math.floor(Number(pct) / 10)));
      lines.push(`🔹 *${s.name}* ${bar} \`${pct}%\``);
    }
    if (actions.length) {
      lines.push('', '📈 *توصیه‌ها:*');
      for (const a of actions) lines.push(`🔸 ${a.serverName}: \`${a.loadPercent}%\` — ${a.suggestedAction}`);
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminAnalytics(ctx) {
  await ctx.answerCbQuery();
  try {
    const [retention, churn, popularity] = await Promise.all([
      AdminAnalyticsService.getRetentionRate(),
      AdminAnalyticsService.getChurnRate(),
      AdminAnalyticsService.getServerPopularity(),
    ]);
    const lines = [
      '📈 *داشبورد تحلیلی*', '',
      `📈 نرخ ماندگاری: \`${retention.retentionRate}%\``,
      `📉 نرخ ریزش: \`${churn.churnRate}%\` (${churn.churnedLast30} ریزش/۳۰روز)`,
      '', '🌟 *محبوبیت سرورها:*',
    ];
    for (const s of popularity) lines.push(`🔹 ${s.serverName}: \`${s.subscriberCount}\` کاربر`);
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminSecurity(ctx) {
  await ctx.answerCbQuery();
  try {
    const logs  = await AdminLogService.getLogs({}, 1, 10);
    const lines = ['🛡️ *امنیت*', '', `📋 آخرین \`${logs.logs.length}\` رویداد:`, ''];
    for (const log of logs.logs) {
      const d = log.createdAt ? new Date(log.createdAt).toLocaleDateString('fa-IR') : '—';
      lines.push(`🔹 ${d} — \`${log.action}\``);
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminTickets(ctx) {
  await ctx.answerCbQuery();
  try {
    const [open, answered, closed] = await Promise.all([
      Ticket.countDocuments({ status: 'open' }),
      Ticket.countDocuments({ status: 'answered' }),
      Ticket.countDocuments({ status: 'closed' }),
    ]);
    const recent = await Ticket.find().populate('userId', 'telegramId').sort({ updatedAt: -1 }).limit(5).lean();
    const lines  = ['🎫 *پشتیبانی*', '', `📬 باز: \`${open}\` | 💬 پاسخ: \`${answered}\` | ✅ بسته: \`${closed}\``];
    if (recent.length) {
      lines.push('', '📋 *آخرین تیکت‌ها:*');
      for (const t of recent) {
        const icon = t.status === 'open' ? '⚠️' : t.status === 'answered' ? '💬' : '✅';
        lines.push(`${icon} ${t.userId?.telegramId || 'ناشناس'} — \`${t.status}\``);
      }
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminSubscriptions(ctx) {
  await ctx.answerCbQuery();
  try {
    const subs  = await Subscription.find().populate('ownerId', 'telegramId').sort({ createdAt: -1 }).limit(10).lean();
    const lines = ['📋 *آخرین اشتراک‌ها*', ''];
    const icon  = s => ({ active: '✅', on_hold: '⏳', expired: '❌', suspended: '🚫' })[s] || '⚪';
    for (const s of subs) {
      lines.push(
        `${icon(s.status)} \`${s.ownerId?.telegramId || '—'}\` | \`${s.status}\``,
        `   انقضا: ${s.expireDate ? formatDate(new Date(s.expireDate)) : '—'}`,
        '',
      );
    }
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminReceipts(ctx) {
  await ctx.answerCbQuery();
  try {
    const pending = await Receipt.find({ status: 'pending' }).populate('userId', 'telegramId').sort({ createdAt: -1 }).limit(5).lean();
    const total   = await Receipt.countDocuments({ status: 'pending' });
    const lines   = ['🧾 *رسیدها در انتظار*', '', `تعداد: \`${total}\``, ''];
    const buttons = [];
    for (const r of pending) {
      lines.push(`🔹 \`${r.userId?.telegramId || '—'}\` — ${formatRials(r.amount)}`);
      buttons.push([
        Markup.button.callback('✅ تأیید', `receipt_approve_${r._id}`),
        Markup.button.callback('❌ رد',   `receipt_reject_${r._id}`),
      ]);
    }
    if (!pending.length) lines.push('هیچ رسیدی در انتظار نیست.');
    buttons.push([Markup.button.callback('🔙 پنل مدیریت', 'admin_back')]);
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminPromoCodes(ctx) {
  await ctx.answerCbQuery();
  try {
    const promos = await PromoCode.find().sort({ createdAt: -1 }).lean();
    const lines  = ['🎟️ *کدهای تخفیف*', ''];
    for (const p of promos) {
      lines.push(`${p.isActive ? '✅' : '❌'} \`${p.code}\` — \`${p.discountPercent}%\` | مصرف: \`${p.usedCount || 0}\``);
    }
    if (!promos.length) lines.push('هیچ کدی یافت نشد.');
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminSettings(ctx) {
  await ctx.answerCbQuery();
  try {
    const settings = await Setting.find().lean();
    const lines    = ['⚙️ *تنظیمات*', ''];
    for (const s of settings) {
      const val = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value);
      lines.push(`🔹 \`${s.key}\`: \`${val}\``);
    }
    if (!settings.length) lines.push('هیچ تنظیماتی ثبت نشده.');
    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...backKeyboard });
  } catch { await safeEdit(ctx, '❌ خطا.', backKeyboard); }
}

export async function handleAdminBackup(ctx) {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '⏳ در حال تهیه پشتیبان...', backKeyboard);
  try {
    const filePath = await AdminService.generateDatabaseBackup();
    await ctx.replyWithDocument({ source: filePath });
    await safeEdit(ctx, '✅ پشتیبان آماده شد.', backKeyboard);
  } catch { await safeEdit(ctx, '❌ پشتیبان‌گیری انجام نشد.', backKeyboard); }
}

export async function handleReceiptAction(ctx) {
  await ctx.answerCbQuery();
  const action    = ctx.match[1];
  const receiptId = ctx.match[2];
  try {
    const admin   = await UserService.resolveUser(ctx.from.id);
    const receipt = await PaymentService.processReceipt(receiptId, admin._id, action);
    const userDoc = await User.findById(receipt.userId);
    if (action === 'approve') {
      await safeEdit(ctx, `✅ رسید تأیید شد — ${formatRials(receipt.amount)}`, { parse_mode: 'Markdown' });
      if (userDoc) await ctx.telegram.sendMessage(userDoc.telegramId,
        `✅ پرداخت شما تأیید شد\n💰 مبلغ: ${formatRials(receipt.amount)}`, { parse_mode: 'Markdown' });
    } else {
      await safeEdit(ctx, `❌ رسید رد شد — \`${receipt._id}\``, { parse_mode: 'Markdown' });
      if (userDoc) await ctx.telegram.sendMessage(userDoc.telegramId,
        '❌ رسید شما رد شد. با پشتیبانی تماس بگیرید.', { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await safeEdit(ctx, formatError(err), Markup.inlineKeyboard([[Markup.button.callback('🔙', 'admin_back')]]));
  }
}

export async function handleAdminAddPromo(ctx) {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '🎟️ برای ایجاد کد تخفیف از API استفاده کنید:\n`POST /api/admin/promo-codes`',
    { parse_mode: 'Markdown', ...backKeyboard });
}
