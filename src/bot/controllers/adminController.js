import UserService from '../../services/UserService.js';
import AdminService from '../../services/admin/AdminService.js';
import AdminDashboardService from '../../services/admin/AdminDashboardService.js';
import AdminServerService from '../../services/admin/AdminServerService.js';
import AdminPlanService from '../../services/admin/AdminPlanService.js';
import AdminFinanceService from '../../services/admin/AdminFinanceService.js';
import AdminBotService from '../../services/admin/AdminBotService.js';
import AdminBandwidthService from '../../services/admin/AdminBandwidthService.js';
import AdminAnalyticsService from '../../services/admin/AdminAnalyticsService.js';
import AdminLogService from '../../services/admin/AdminLogService.js';
import PaymentService from '../../services/PaymentService.js';
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
import { formatRials, formatBytes, formatDate, formatError } from '../utils.js';
const panelKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📊 داشبورد', 'admin_dashboard'),
   Markup.button.callback('👤 کاربران', 'admin_users')],
  [Markup.button.callback('🌐 سرورها', 'admin_servers'),
   Markup.button.callback('📦 پلن‌ها', 'admin_plans')],
  [Markup.button.callback('💰 امور مالی', 'admin_finance'),
   Markup.button.callback('🤖 مدیریت پیام‌ها', 'admin_bot')],
  [Markup.button.callback('📊 پهنای باند', 'admin_bandwidth'),
   Markup.button.callback('🛡️ امنیت', 'admin_security')],
  [Markup.button.callback('📈 داشبورد تحلیلی', 'admin_analytics'),
   Markup.button.callback('🆘 پشتیبانی', 'admin_tickets')],
  [Markup.button.callback('📋 اشتراک‌ها', 'admin_subscriptions'),
   Markup.button.callback('📄 رسیدها', 'admin_receipts')],
  [Markup.button.callback('🎫 کدهای تخفیف', 'admin_promos'),
   Markup.button.callback('⚙️ تنظیمات', 'admin_settings')],
  [Markup.button.callback('💾 پشتیبان', 'admin_backup'),
   Markup.button.callback('📊 آمار', 'admin_metrics')],
  [Markup.button.callback('🔙 منوی اصلی', 'main_menu')],
]);

const backKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 بازگشت به پنل مدیریت', 'admin_back')],
]);

async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err?.description?.includes('message is not modified')) return;
    throw err;
  }
}

export async function adminCommand(ctx) {
  const user = await UserService.resolveUser(ctx.from.id);

  if (!hasRole(user.role, ['support', 'superadmin'])) {
    await ctx.reply('🚫 شما دسترسی به پنل مدیریت ندارید.');
    return;
  }

  ctx.user = user;

  const lines = [
    '📊 *پنل مدیریت HORNET*',
    '',
    '📊 داشبورد  👤 کاربران  🌐 سرورها',
    '📦 پلن‌ها  💰 امور مالی  🤖 مدیریت پیام‌ها',
    '📊 پهنای باند  🛡️ امنیت  📈 داشبورد تحلیلی',
    '🆘 پشتیبانی  💾 پشتیبان  📊 آمار',
    '',
    'بخش مورد نظر را انتخاب کنید:',
  ];

  await ctx.replyWithMarkdown(lines.join('\n'), panelKeyboard);
}

export async function handleAdminBack(ctx) {
  await ctx.answerCbQuery();
  const lines = [
    '📊 *پنل مدیریت HORNET*',
    '',
    '📊 داشبورد  👤 کاربران  🌐 سرورها',
    '📦 پلن‌ها  💰 امور مالی  🤖 مدیریت پیام‌ها',
    '📊 پهنای باند  🛡️ امنیت  📈 داشبورد تحلیلی',
    '🆘 پشتیبانی  💾 پشتیبان  📊 آمار',
    '',
    'بخش مورد نظر را انتخاب کنید:',
  ];
  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...panelKeyboard,
  });
}

export async function handleAdminMetrics(ctx) {
  await ctx.answerCbQuery();
  try {
    const metrics = await AdminService.getGlobalMetrics();
    const lines = [
      '📊 *آمار سریع*',
      '',
      `🔹 کل کاربران: \`${metrics.totalUsers}\``,
      `✅ کاربران فعال: \`${metrics.activeSubscriptions}\``,
      `📊 ترافیک مصرفی: \`${metrics.totalBandwidthGB}\` GB`,
      `💰 درآمد ماهانه: ${formatRials(metrics.monthlyRevenue)}`,
    ];
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت آمار.',
      backKeyboard,
    );
  }
}

export async function handleAdminBackup(ctx) {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '⏳ در حال تهیه پشتیبان از پایگاه داده... لطفاً صبر کنید.',
    backKeyboard,
  );
  try {
    const filePath = await AdminService.generateDatabaseBackup();
    await ctx.replyWithDocument({ source: filePath });
    await safeEdit(ctx, '✅ پشتیبان با موفقیت آماده شد.',
      Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت به پنل مدیریت', 'admin_back')]]),
    );
  } catch {
    await safeEdit(ctx, '❌ پشتیبان‌گیری انجام نشد.',
      backKeyboard,
    );
  }
}

export async function handleAdminDashboard(ctx) {
  await ctx.answerCbQuery();
  try {
    const dash = await AdminDashboardService.getDashboard();

    const totalServers = dash.serverTotal;
    const nearCapacity = await Server.countDocuments({
      status: 'active',
      $expr: {
        $gte: [
          { $divide: ['$currentActiveUsers', '$maxCapacity'] },
          0.8,
        ],
      },
    });

    const lines = [
      '📊 *پنل مدیریت HORNET*',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      `💰 درآمد امروز: ${formatRials(dash.todayRevenue)}`,
      `🔹 کل کاربران: \`${dash.totalUsers}\``,
      `✅ کاربران فعال: \`${dash.activeSubscriptions}\``,
      `📊 ترافیک امروز: \`${dash.todayBandwidthGB}\` GB`,
      `✅ سرورهای سالم: \`${dash.serverHealthy}\`/\`${totalServers}\``,
      `⚠️ سرورهای نزدیک ظرفیت: \`${nearCapacity}\``,
    ];

    const dashboardActions = Markup.inlineKeyboard([
      [Markup.button.callback('📊 آمار', 'admin_metrics'),
       Markup.button.callback('🌐 سرورها', 'admin_servers')],
      [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
    ]);

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...dashboardActions,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت داشبورد.', backKeyboard);
  }
}

export async function handleAdminUsers(ctx) {
  await ctx.answerCbQuery();
  try {
    const total = await User.countDocuments();
    const banned = await User.countDocuments({ role: 'banned' });
    const activeSubs = await Subscription.countDocuments({ status: 'active' });

    const lines = [
      '👤 *مدیریت کاربران*',
      '',
      `🔹 کل کاربران: \`${total}\``,
      `✅ کاربران فعال: \`${activeSubs}\``,
      `🚫 مسدود شده: \`${banned}\``,
      '',
      '🔍 برای جستجو، شناسه تلگرام را ارسال کنید.',
    ];

    const userActions = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 ریست ترافیک همه', 'admin_user_reset_all')],
      [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
    ]);

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...userActions,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت اطلاعات کاربران.', backKeyboard);
  }
}

export async function handleAdminUserResetAll(ctx) {
  await ctx.answerCbQuery();
  const subs = await Subscription.updateMany(
    { status: 'active' },
    { $set: { usedVolumeBytes: 0 } },
  );
  await safeEdit(ctx,
    `✅ ترافیک \`${subs.modifiedCount}\` کاربر فعال ریست شد.`,
    { parse_mode: 'Markdown', ...backKeyboard },
  );
}

export async function handleAdminServers(ctx) {
  await ctx.answerCbQuery();
  try {
    const servers = await AdminServerService.getAllServers();

    if (servers.length === 0) {
      await safeEdit(ctx, '🌐 هیچ سروری ثبت نشده.', backKeyboard);
      return;
    }

    const lines = ['🌐 *مدیریت سرورها*', ''];
    for (const s of servers) {
      const statusIcon = s.status === 'active' ? '✅' : '❌';
      lines.push(
        `${statusIcon} *${s.name}*`,
        `   IP: \`${s.ipAddress}\` | کاربران: \`${s.currentActiveUsers}\`/\`${s.maxCapacity}\``,
        `   بار: \`${s.loadPercent}%\` | وضعیت: ${s.status === 'active' ? '✅ فعال' : '🔧 تعمیرات'}`,
        '',
      );
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت لیست سرورها.', backKeyboard);
  }
}

export async function handleAdminPlans(ctx) {
  await ctx.answerCbQuery();
  try {
    const plans = await AdminPlanService.getAllPlans();

    if (plans.length === 0) {
      await safeEdit(ctx, '📦 هیچ پلنی تعریف نشده.', backKeyboard);
      return;
    }

    const lines = ['📦 *مدیریت پلن‌ها*', ''];
    for (const p of plans) {
      const category = p.category ? ` [${p.category}]` : '';
      lines.push(
        `🔹 *${p.title}*${category}`,
        `   ترافیک: \`${p.baseVolumeGB}\` GB | مدت: \`${p.durationDays}\` روز`,
        `   قیمت: ${formatRials(p.basePrice)} | کاربران: \`${p.maxSubLinks}\``,
        `   وضعیت: ${p.isActive ? '✅ فعال' : '❌ غیرفعال'}`,
        '',
      );
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت پلن‌ها.', backKeyboard);
  }
}

export async function handleAdminFinance(ctx) {
  await ctx.answerCbQuery();
  try {
    const now = new Date();
    const monthly = await AdminFinanceService.getMonthlySales(
      now.getFullYear(),
      now.getMonth() + 1,
    );
    const dailySales = await AdminFinanceService.getDailySales(1);
    const todayRevenue = dailySales.length > 0 ? dailySales[0].revenue : 0;
    const todayCount = dailySales.length > 0 ? dailySales[0].count : 0;

    const lines = [
      '💰 *امور مالی*',
      '',
      `💰 درآمد امروز: ${formatRials(todayRevenue)} (\`${todayCount}\` تراکنش)`,
      `📊 درآمد ماهانه: ${formatRials(monthly.totalRevenue)} (\`${monthly.totalSales}\` تراکنش)`,
    ];

    const projection = await AdminFinanceService.getRevenueProjection();
    lines.push(
      `📈 پیش‌بینی ۳ ماهه: ${formatRials(projection.projection3Months)}`,
    );

    const financeActions = Markup.inlineKeyboard([
      [Markup.button.callback('📅 فروش روزانه', 'admin_finance_daily')],
      [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
    ]);

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...financeActions,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت اطلاعات مالی.', backKeyboard);
  }
}

export async function handleAdminFinanceDaily(ctx) {
  await ctx.answerCbQuery();
  try {
    const daily = await AdminFinanceService.getDailySales(7);
    const lines = ['📅 *فروش ۷ روز اخیر*', ''];
    for (const d of daily) {
      lines.push(`🔹 ${d._id} : ${formatRials(d.revenue)} (\`${d.count}\` فروش)`);
    }
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت فروش روزانه.', backKeyboard);
  }
}

export async function handleAdminBot(ctx) {
  await ctx.answerCbQuery();
  const lines = [
    '🤖 *مدیریت پیام‌ها*',
    '',
    '🔹 ارسال پیام همگانی به کاربران',
    '🔹 مدیریت پیام‌های خودکار',
    '',
    'مخاطب مورد نظر را انتخاب کنید:',
  ];

  const botActions = Markup.inlineKeyboard([
    [Markup.button.callback('📢 همه کاربران', 'admin_broadcast_all')],
    [Markup.button.callback('📢 کاربران فعال', 'admin_broadcast_active')],
    [Markup.button.callback('📢 کاربران منقضی', 'admin_broadcast_expired')],
    [Markup.button.callback('🔙 پنل مدیریت', 'admin_back')],
  ]);

  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...botActions,
  });
}

export async function handleAdminBroadcast(ctx) {
  await ctx.answerCbQuery();
  const raw = ctx.match?.[0] || ctx.match || '';
  const audience = typeof raw === 'string' ? raw.replace('admin_broadcast_', '') : 'all';
  const targetIds = await AdminBotService.getBroadcastTargets(audience);

  const labels = { all: 'همه کاربران', active: 'کاربران فعال', expired: 'کاربران منقضی' };

  const lines = [
    '📢 *ارسال پیام همگانی*',
    '',
    `مخاطب: ${labels[audience] || audience}`,
    `تعداد: \`${targetIds.length}\` کاربر`,
    '',
    'برای ارسال پیام از API استفاده کنید:',
    '`POST /api/enterprise/bot/broadcast`',
  ];

  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...backKeyboard,
  });
}

export async function handleAdminBandwidth(ctx) {
  await ctx.answerCbQuery();
  try {
    const actions = await AdminBandwidthService.getLoadAwareScalingActions();

    const lines = ['📊 *مدیریت پهنای باند*', ''];

    const servers = await Server.find({ status: 'active' }).lean();
    if (servers.length === 0) {
      lines.push('هیچ سرور فعالی یافت نشد.');
    } else {
      lines.push('📊 *بار سرورها:*');
      for (const s of servers) {
        const loadPct = s.maxCapacity > 0
          ? ((s.currentActiveUsers / s.maxCapacity) * 100).toFixed(1)
          : '100.0';
        const bar = '▰'.repeat(Math.floor(Number(loadPct) / 10)) + '▱'.repeat(10 - Math.floor(Number(loadPct) / 10));
        lines.push(`🔹 *${s.name}* ${bar} \`${loadPct}%\``);
      }
    }

    if (actions.length > 0) {
      lines.push('');
      lines.push('📈 *توصیه داشبورد تحلیلی:*');
      for (const a of actions) {
        lines.push(`🔸 ${a.serverName}: بار \`${a.loadPercent}%\` — ${a.suggestedAction}`);
      }
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت اطلاعات پهنای باند.', backKeyboard);
  }
}

export async function handleAdminSecurity(ctx) {
  await ctx.answerCbQuery();
  try {
    const logs = await AdminLogService.getLogs({}, 1, 10);

    const lines = [
      '🛡️ *امنیت سرویس*',
      '',
      `📋 آخرین \`${logs.logs.length}\` رویداد از \`${logs.total}\` رویداد:`,
      '',
    ];

    for (const log of logs.logs) {
      const adminInfo = log.adminId?.telegramId || 'سیستم';
      const date = log.createdAt
        ? new Date(log.createdAt).toLocaleDateString('fa-IR')
        : '—';
      lines.push(`🔹 ${date} — ${adminInfo} — \`${log.action}\``);
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت لاگ‌ها.', backKeyboard);
  }
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
      '📈 *داشبورد تحلیلی*',
      '',
      `📈 نرخ ماندگاری: \`${retention.retentionRate}%\` (\`${retention.activeUsers}\` فعال از \`${retention.totalUsers}\`)`,
      `📉 نرخ ریزش: \`${churn.churnRate}%\` (\`${churn.churnedLast30}\` ریزش در ۳۰ روز)`,
      '',
      '🌟 *محبوبیت سرورها:*',
    ];

    for (const s of popularity) {
      lines.push(`🔹 ${s.serverName}: \`${s.subscriberCount}\` کاربر`);
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت آنالیتیکس.', backKeyboard);
  }
}

export async function handleAdminTickets(ctx) {
  await ctx.answerCbQuery();
  try {
    const open = await Ticket.countDocuments({ status: 'open' });
    const answered = await Ticket.countDocuments({ status: 'answered' });
    const closed = await Ticket.countDocuments({ status: 'closed' });

    const lines = [
      '🆘 *پشتیبانی*',
      '',
      `📬 باز: \`${open}\``,
      `💬 پاسخ داده شده: \`${answered}\``,
      `✅ بسته شده: \`${closed}\``,
    ];

    const recentTickets = await Ticket.find()
      .populate('userId', 'telegramId')
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean();

    if (recentTickets.length > 0) {
      lines.push('', '📋 *آخرین تیکت‌ها:*');
      for (const t of recentTickets) {
        const user = t.userId?.telegramId || 'ناشناس';
        const statusIcon = t.status === 'open' ? '⚠️' : t.status === 'answered' ? '💬' : '✅';
        lines.push(`${statusIcon} ${user} — \`${t.status}\``);
      }
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت تیکت‌ها.', backKeyboard);
  }
}

export async function handleReceiptAction(ctx) {
  await ctx.answerCbQuery();

  const action = ctx.match[1];
  const receiptId = ctx.match[2];

  try {
    const admin = await UserService.resolveUser(ctx.from.id);
    const receipt = await PaymentService.processReceipt(receiptId, admin._id, action);

    if (action === 'approve') {
      const lines = [
        '✅ *رسید تأیید شد*',
        '',
        `🔹 رسید: \`${receipt._id}\``,
        `🔹 مبلغ: ${formatRials(receipt.amount)}`,
      ];

      await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown' });

      const userDoc = await User.findById(receipt.userId);
      if (userDoc) {
        const notifyLines = [
          '✅ *پرداخت شما تأیید شد*',
          '',
          '💰 مبلغ: ' + formatRials(receipt.amount),
          '💰 موجودی کیف پول: ' + formatRials(userDoc.walletBalance),
          '',
          'می‌توانید از طریق خرید طرح از سرویس استفاده کنید.',
        ];

        await ctx.telegram.sendMessage(
          userDoc.telegramId,
          notifyLines.join('\n'),
          { parse_mode: 'Markdown' },
        );
      }
    } else {
      await safeEdit(ctx,
        '❌ *رسید رد شد*\n\n🆔 `' + receipt._id + '`',
        { parse_mode: 'Markdown' },
      );

      const userDoc = await User.findById(receipt.userId);
      if (userDoc) {
        const notifyLines = [
          '❌ *پرداخت شما رد شد*',
          '',
          '🔹 رسید: `' + receipt._id + '`',
          '',
          'رسید شما قابل تأیید نبود.',
          'با پشتیبانی تماس بگیرید.',
        ];

        await ctx.telegram.sendMessage(
          userDoc.telegramId,
          notifyLines.join('\n'),
          { parse_mode: 'Markdown' },
        );
      }
    }
  } catch (err) {
    const msg = formatError(err);
    await safeEdit(ctx, msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'main_menu')]]));
  }
}

export async function handleAdminSubscriptions(ctx) {
  await ctx.answerCbQuery();
  try {
    const subs = await Subscription.find()
      .populate('ownerId', 'telegramId')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    if (subs.length === 0) {
      await safeEdit(ctx, '📋 هیچ اشتراکی یافت نشد.', backKeyboard);
      return;
    }

    const lines = ['📋 *آخرین اشتراک‌ها*', ''];
    for (const s of subs) {
      const owner = s.ownerId?.telegramId || 'ناشناس';
      const statusIcon = s.status === 'active' ? '✅' : s.status === 'expired' ? '❌' : '⚠️';
      lines.push(
        `${statusIcon} کاربر: \`${owner}\``,
        `   پلن: \`${s.planId || '—'}\` | وضعیت: \`${s.status}\``,
        `   انقضا: ${s.expireDate ? formatDate(s.expireDate) : '—'}`,
        '',
      );
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت اشتراک‌ها.', backKeyboard);
  }
}

export async function handleAdminReceipts(ctx) {
  await ctx.answerCbQuery();
  try {
    const totalPending = await Receipt.countDocuments({ status: 'pending' });
    const pending = await Receipt.find({ status: 'pending' })
      .populate('userId', 'telegramId')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const lines = ['📋 *رسیدهای در انتظار تأیید*', ''];
    lines.push(`تعداد کل: \`${totalPending}\` رسید`);
    lines.push('');

    const buttons = [];
    for (const r of pending) {
      const userInfo = r.userId?.telegramId || 'ناشناس';
      lines.push(
        `🔹 کاربر: \`${userInfo}\``,
        `   مبلغ: ${formatRials(r.amount)}`,
        `   تاریخ: ${r.createdAt ? formatDate(r.createdAt) : '—'}`,
        '',
      );
      buttons.push([
        Markup.button.callback('✅ تایید', `admin_receipt_approve:${r._id}`),
        Markup.button.callback('❌ رد', `admin_receipt_reject:${r._id}`),
      ]);
    }

    if (pending.length === 0) {
      lines.push('هیچ رسید در انتظار تأییدی وجود ندارد.');
    }

    buttons.push([Markup.button.callback('🔙 پنل مدیریت', 'admin_back')]);

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت رسیدها.', backKeyboard);
  }
}

export async function handleAdminPromoCodes(ctx) {
  await ctx.answerCbQuery();
  try {
    const promos = await PromoCode.find().sort({ createdAt: -1 }).lean();

    if (promos.length === 0) {
      await safeEdit(ctx, '🎫 هیچ کد تخفیفی یافت نشد.', backKeyboard);
      return;
    }

    const lines = ['🎫 *کدهای تخفیف*', ''];
    for (const p of promos) {
      const statusIcon = p.isActive ? '✅' : '❌';
      const expiresText = p.expiresAt
        ? ` | اعتبار تا: ${formatDate(p.expiresAt)}`
        : ' | اعتبار: نامحدود';
      const usageText = p.usageLimit
        ? `\`${p.usedCount}\`/\`${p.usageLimit}\``
        : `\`${p.usedCount}\`/∞`;
      lines.push(
        `${statusIcon} کد: \`${p.code}\``,
        `   تخفیف: \`${p.discountPercent}%\` | مصرف: ${usageText}${expiresText}`,
        '',
      );
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت کدهای تخفیف.', backKeyboard);
  }
}

export async function handleAdminSettings(ctx) {
  await ctx.answerCbQuery();
  try {
    const settings = await Setting.find().lean();

    const lines = ['⚙️ *تنظیمات سرویس*', ''];

    if (settings.length === 0) {
      lines.push('هیچ تنظیماتی ثبت نشده.');
    } else {
      for (const s of settings) {
        const val = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value);
        lines.push(`🔹 \`${s.key}\`: \`${val}\``);
      }
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...backKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت تنظیمات.', backKeyboard);
  }
}

export async function handleAdminUserDetail(ctx) {
  const telegramId = ctx.message?.text?.trim();
  if (!telegramId || !/^\d+$/.test(telegramId)) {
    await ctx.reply('❌ لطفاً یک شناسه تلگرام معتبر ارسال کنید.', backKeyboard);
    return;
  }

  try {
    const user = await User.findOne({ telegramId }).lean();
    if (!user) {
      await ctx.reply('❌ کاربری با این شناسه یافت نشد.', backKeyboard);
      return;
    }

    const [subs, receipts] = await Promise.all([
      Subscription.find({ ownerId: user._id }).sort({ createdAt: -1 }).limit(5).lean(),
      Receipt.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    const lines = [
      '📋 *مشخصات کاربر*',
      '',
      `🔹 شناسه: \`${user.telegramId}\``,
      `🔹 نقش: \`${user.role || 'user'}\``,
      `💰 کیف پول: ${formatRials(user.walletBalance || 0)}`,
      `💰 مجموع پرداخت: ${formatRials(user.totalSpent || 0)}`,
      `📋 تاریخ ثبت: ${user.createdAt ? formatDate(user.createdAt) : '—'}`,
    ];

    if (subs.length > 0) {
      lines.push('', '📊 *اشتراک‌ها:*');
      for (const s of subs) {
        const statusIcon = s.status === 'active' ? '✅' : s.status === 'expired' ? '❌' : '⚠️';
        lines.push(
          `${statusIcon} پلن: \`${s.planId || '—'}\``,
          `   وضعیت: \`${s.status}\` | انقضا: ${s.expireDate ? formatDate(s.expireDate) : '—'}`,
          `   مصرف: ${formatBytes(s.usedVolumeBytes || 0)}`,
        );
      }
    }

    if (receipts.length > 0) {
      lines.push('', '📄 *رسیدها:*');
      for (const r of receipts) {
        const statusIcon = r.status === 'approved' ? '✅' : r.status === 'rejected' ? '❌' : '⚠️';
        lines.push(
          `${statusIcon} مبلغ: ${formatRials(r.amount)}`,
          `   وضعیت: \`${r.status}\` | تاریخ: ${r.createdAt ? formatDate(r.createdAt) : '—'}`,
        );
      }
    }

    await ctx.replyWithMarkdown(lines.join('\n'), backKeyboard);
  } catch {
    await ctx.reply('❌ خطا در دریافت اطلاعات کاربر.', backKeyboard);
  }
}

export async function handleAdminAddPromo(ctx) {
  await ctx.answerCbQuery();
  const lines = [
    '🎫 *افزودن کد تخفیف*',
    '',
    'برای ایجاد کد تخفیف از API استفاده کنید:',
    '`POST /api/admin/promo-codes`',
    '',
    '🔹 پارامترهای مورد نیاز:',
    '   • `code` — کد تخفیف (اجباری)',
    '   • `discountPercent` — درصد تخفیف (اجباری)',
    '   • `usageLimit` — حداکثر تعداد مصرف (اختیاری)',
    '   • `expiresAt` — تاریخ انقضا (اختیاری)',
    '   • `maxDiscountAmount` — حداکثر مبلغ تخفیف (اختیاری)',
  ];

  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...backKeyboard,
  });
}

export async function handleAdminPlanToggle(ctx) {
  await ctx.answerCbQuery();
  const planId = ctx.match[1];

  try {
    const plan = await Plan.findById(planId).lean();
    if (!plan) {
      await safeEdit(ctx, '❌ پلن یافت نشد.', backKeyboard);
      return;
    }

    await Plan.findByIdAndUpdate(planId, { $set: { isActive: !plan.isActive } });
    const newStatus = !plan.isActive ? '✅ فعال' : '❌ غیرفعال';

    await safeEdit(ctx,
      `✅ وضعیت پلن \`${plan.title}\` به ${newStatus} تغییر یافت.`,
      { parse_mode: 'Markdown', ...backKeyboard },
    );
  } catch {
    await safeEdit(ctx, '❌ خطا در تغییر وضعیت پلن.', backKeyboard);
  }
}
