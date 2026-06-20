import { Markup, Scenes } from 'telegraf';
import { User, Subscription, Plan, TunnelConfig, Setting, Receipt, Ticket, Server, AuditLog } from '../models/index.js';
import subscriptionService from '../services/SubscriptionService.js';
import tunnelService from '../services/TunnelService.js';
import paymentService from '../services/PaymentService.js';
import adminService from '../services/AdminService.js';
import adminDashboardService from '../services/admin/adminDashboardService.js';
import adminUserService from '../services/admin/adminUserService.js';
import adminServerService from '../services/admin/adminServerService.js';
import adminPlanService from '../services/admin/adminPlanService.js';
import adminFinanceService from '../services/admin/adminFinanceService.js';
import adminBotService from '../services/admin/adminBotService.js';
import adminBandwidthService from '../services/admin/adminBandwidthService.js';
import adminAnalyticsService from '../services/admin/adminAnalyticsService.js';
import adminTicketService from '../services/admin/adminTicketService.js';
import adminLogService from '../services/admin/adminLogService.js';
import { hasRole } from '../utils/rbac.js';
import { formatRials, formatRank } from '../utils/formatters.js';
import receiptUploadScene from '../scenes/receiptUploadScene.js';
import {
  NotFoundError,
  InsufficientQuotaError,
  InsufficientBalanceError,
  SubscriptionExpiredError,
  SubscriptionSuspendedError,
  SubscriptionNotActiveError,
  MaxSubLinksReachedError,
  SharedPaymentNotPendingError,
} from '../utils/errors.js';

const GB = 1073741824;

function sanitizeName(raw) {
  return raw.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'Unnamed';
}

async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err?.description?.includes('message is not modified')) return;
    throw err;
  }
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '♾️ نامحدود';
  const gb = bytes / GB;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date) {
  if (!date) return '—';
  return date.toLocaleDateString('fa-IR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Inline keyboards
// ---------------------------------------------------------------------------

const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🏠 کندوی من', 'my_subscriptions')],
  [Markup.button.callback('⚡ ارتقاء بال‌ها', 'buy_renew')],
  [Markup.button.callback('🎁 هدیه شهد', 'free_trial')],
  [Markup.button.callback('📊 وضعیت پرواز', 'profile')],
]);

const adminMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🏠 داشبورد کندو', 'admin_dashboard'),
   Markup.button.callback('👤 زنبورها', 'admin_users')],
  [Markup.button.callback('🌐 کندوها', 'admin_servers'),
   Markup.button.callback('📦 پلن‌ها', 'admin_plans')],
  [Markup.button.callback('🍯 اقتصاد شهد', 'admin_finance'),
   Markup.button.callback('🤖 ربات ملکه', 'admin_bot')],
  [Markup.button.callback('⚡ بال‌ها', 'admin_bandwidth'),
   Markup.button.callback('🛡️ امنیت', 'admin_security')],
  [Markup.button.callback('🧠 هوش مصنوعی ملکه', 'admin_analytics'),
   Markup.button.callback('🆘 پشتیبانی', 'admin_tickets')],
  [Markup.button.callback('💾 پشتیبان کندو', 'admin_backup'),
   Markup.button.callback('📊 آمار', 'admin_metrics')],
  [Markup.button.callback('🔙 منوی اصلی', 'main_menu')],
]);

const adminBackKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 بازگشت به مرکز کنترل', 'admin_back')],
]);


function subscriptionActionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ لینک جدید', 'create_sublink')],
    [Markup.button.callback('🔙 HORNET NEST', 'main_menu')],
  ]);
}

// ---------------------------------------------------------------------------
// Error formatter
// ---------------------------------------------------------------------------

function formatError(error) {
  if (error instanceof InsufficientQuotaError) {
    return '⚠️ ظرفیت درخواستی بیش از حد مجاز است. مقدار کمتری انتخاب کنید.';
  }
  if (error instanceof SubscriptionExpiredError) {
    return '⏰ کندوی شما منقضی شده. بال‌های خود را ارتقاء دهید.';
  }
  if (error instanceof SubscriptionSuspendedError) {
    return '🚫 کندوی شما منجمد شده. با پشتیبانی ملکه تماس بگیرید.';
  }
  if (error instanceof SubscriptionNotActiveError) {
    return '❌ کندوی فعالی ندارید. ابتدا بال‌های خود را ارتقاء دهید.';
  }
  if (error instanceof MaxSubLinksReachedError) {
    return '🔒 حداکثر زنبورهای مجاز برای این پلن رسیده است.';
  }
  if (error instanceof NotFoundError) {
    return `❓ ${error.message} یافت نشد.`;
  }
  if (error instanceof InsufficientBalanceError) {
    return '💰 شهد کافی در مخزن ندارید. از طریق پرداخت کارتی شارژ کنید.';
  }
  if (error instanceof SharedPaymentNotPendingError) {
    return '💳 این اشتراک در حالت پرداخت اشتراکی نیست.';
  }
  return '❌ خطایی رخ داد. دوباره تلاش کنید یا با پشتیبانی ملکه تماس بگیرید.';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveUser(telegramId, referralCode) {
  let isNew = false;
  let user = await User.findOne({ telegramId });

  if (!user) {
    isNew = true;
    user = await User.create({ telegramId });
  }

  if (isNew && referralCode && !user.referredBy) {
    const referrer = await User.findOne({ referralCode });
    if (referrer && !referrer._id.equals(user._id)) {
      user.referredBy = referrer._id;
      await user.save();
    }
  }

  return user;
}

async function checkChannelMembership(ctx) {
  const channelId = process.env.CHANNEL_ID;
  if (!channelId) return true;

  try {
    const member = await ctx.telegram.getChatMember(channelId, ctx.from.id);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch {
    return false;
  }
}

async function getSubscriptionSummary(sub, plan, server) {
  const remaining = sub.totalVolumeBytes - sub.usedVolumeBytes;
  const usedPct = sub.totalVolumeBytes > 0
    ? ((sub.usedVolumeBytes / sub.totalVolumeBytes) * 100).toFixed(1)
    : '0.0';
  const honeyBar = '🍯' + '█'.repeat(Math.floor(Number(usedPct) / 10)) + '░'.repeat(10 - Math.floor(Number(usedPct) / 10));

  const serverLine = server
    ? `🏠 Hive: \`${server.name}\` (${server.ipAddress})`
    : null;

  const statusText = sub.status === 'active' ? '🟢 در حال پرواز'
    : sub.status === 'expired' ? '🔴 منقضی'
    : sub.status === 'suspended' ? '❄️ منجمد'
    : '⏳ در انتظار پرداخت';

  const lines = [
    '🐝 *وضعیت کندو*',
    '',
    `📋 پلن: *${plan?.title ?? '—'}*`,
    `🍯 کل شهد: ${formatBytes(sub.totalVolumeBytes)}`,
    `⚡ مصرف شده: ${formatBytes(sub.usedVolumeBytes)} (${usedPct}%)`,
    `${honeyBar}`,
    `🍯 باقی‌مانده: ${formatBytes(remaining)}`,
    `🔄 رول‌اور: ${formatBytes(sub.rolloverVolumeBytes)}`,
    serverLine,
    `📅 ورود به کندو: ${formatDate(sub.startDate)}`,
    `📅 خروج از کندو: ${formatDate(sub.expireDate)}`,
    `🟢 وضعیت: ${statusText}`,
  ];

  return lines.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Scenes / Wizards
// ---------------------------------------------------------------------------

const createSubLinkScene = new Scenes.WizardScene(
  'create-sublink',

  async (ctx) => {
    ctx.wizard.state.data = {};
    await ctx.reply(
      '🔤 *نام لینک را وارد کنید*',
      { parse_mode: 'Markdown' },
    );
    await ctx.reply(
      'یک نام برای این لینک انتخاب کنید:\n' +
      '🔹 مثال: «گوشی من»، «لپ‌تاپ»، «دستگاه همسرم»\n\n' +
      'فقط حروف و اعداد مجاز است.',
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('لطفاً یک نام معتبر وارد کنید.');
      return;
    }
    ctx.wizard.state.data.name = sanitizeName(ctx.message.text);

    await ctx.reply(
      '📏 *محدودیت شهد را تعیین کنید*\n\n' +
      '🔹 `0` : بدون محدودیت (استفاده از کل شهد کندو)\n' +
      '🔹 یا عددی مانند `5` = 5 گیگابایت\n\n' +
      'مقدار را به *گیگابایت* وارد کنید:',
      { parse_mode: 'Markdown' },
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    try {
      const quotaInput = ctx.message?.text?.trim();
      if (!quotaInput || isNaN(Number(quotaInput)) || Number(quotaInput) < 0) {
        await ctx.reply('⚠️ لطفاً یک عدد معتبر وارد کنید.');
        return;
      }

      const quotaGB = Number(quotaInput);
      const allocatedBytes = quotaGB === 0 ? null : quotaGB * GB;

      const user = await resolveUser(ctx.from.id);
      const sub = await Subscription.findOne({ ownerId: user._id, status: 'active' });
      if (!sub) {
        await ctx.reply('❌ کندوی فعالی ندارید. ابتدا بال‌های خود را ارتقاء دهید.');
        return ctx.scene.leave();
      }

      const config = await tunnelService.createSubLink(
        sub._id,
        ctx.wizard.state.data.name,
        allocatedBytes,
        false,
      );

      await ctx.replyWithMarkdown(
        '✅ *لینک ساخته شد*\n\n' +
        `🔹 نام: \`${config.name}\`\n` +
        `🔹 UUID: \`${config.uuid}\`\n` +
        `🔹 شهد: ${formatBytes(config.allocatedQuotaBytes)}\n` +
        `🔹 وضعیت: ${config.isActive ? '✅ فعال' : '❌ غیرفعال'}`,
      );

      await showMainMenu(ctx);
    } catch (error) {
      await ctx.reply(formatError(error));
      await showMainMenu(ctx);
    }

    return ctx.scene.leave();
  },
);

// ---------------------------------------------------------------------------
// Controller methods
// ---------------------------------------------------------------------------

export async function registerScenes(stage) {
  stage.register(createSubLinkScene);
  stage.register(receiptUploadScene);
}

export async function startCommand(ctx) {
  const payload = ctx.payload?.trim().toUpperCase();
  const referralCode = payload && payload.length <= 10 ? payload : null;

  const user = await resolveUser(ctx.from.id, referralCode);

  const rankLabel = formatRank(user.rank);

  const lines = [
    '🐝 به *HORNET* خوش آمدید',
    '',
    '🔹 اینترنت پرسرعت با فناوری پیشرفته',
    '🔹 مدیریت کندو و بال‌های خود',
    '🔹 پشتیبانی ۲۴ ساعته ملکه',
    '',
  ];

  if (user.joinedAt && user.joinedAt.getTime() === user.updatedAt?.getTime()) {
    lines.push(`🥚 رتبه شما: ${rankLabel}`);
    lines.push('✅ کندوی شما ساخته شد.');

    if (user.referredBy) {
      lines.push(`🎁 شما دعوت شده‌اید! کد هدیه: \`${user.referralCode}\``);
    }

    lines.push('');
  }

  await ctx.replyWithMarkdown(lines.join('\n'), mainMenuKeyboard);
}

// ---------------------------------------------------------------------------
// Admin command — RBAC protected
// ---------------------------------------------------------------------------

export async function adminCommand(ctx) {
  const user = await resolveUser(ctx.from.id);

  if (!hasRole(user.role, ['support', 'superadmin'])) {
    await ctx.reply('🚫 شما دسترسی به مرکز کنترل ندارید.');
    return;
  }

  ctx.user = user;

  const lines = [
    '🐝 *HORNET CONTROL CENTER*',
    '',
    '🏠 داشبورد  👤 زنبورها  🌐 کندوها',
    '📦 پلن‌ها  🍯 اقتصاد  🤖 ربات ملکه',
    '⚡ بال‌ها  🛡️ امنیت  🧠 هوش مصنوعی',
    '🆘 پشتیبانی  💾 پشتیبان  📊 آمار',
    '',
    'یک بخش را انتخاب کنید:',
  ];

  await ctx.replyWithMarkdown(lines.join('\n'), adminMenuKeyboard);
}

export async function handleAdminBack(ctx) {
  await ctx.answerCbQuery();
  const lines = [
    '🐝 *HORNET CONTROL CENTER*',
    '',
    '🏠 داشبورد  👤 زنبورها  🌐 کندوها',
    '📦 پلن‌ها  🍯 اقتصاد  🤖 ربات ملکه',
    '⚡ بال‌ها  🛡️ امنیت  🧠 هوش مصنوعی',
    '🆘 پشتیبانی  💾 پشتیبان  📊 آمار',
    '',
    'یک بخش را انتخاب کنید:',
  ];
  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...adminMenuKeyboard,
  });
}

export async function handleAdminMetrics(ctx) {
  await ctx.answerCbQuery();
  try {
    const metrics = await adminService.getGlobalMetrics();
    const lines = [
      '📊 *آمار سریع*',
      '',
      `🐝 کل زنبورها: \`${metrics.totalUsers}\``,
      `🟢 زنبورهای فعال: \`${metrics.activeSubscriptions}\``,
      `🍯 شهد مصرفی: \`${metrics.totalBandwidthGB}\` GB`,
      `💰 شهد ماهانه: ${formatRials(metrics.monthlyRevenue)}`,
    ];
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...adminBackKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت آمار.',
      adminBackKeyboard,
    );
  }
}

export async function handleAdminBackup(ctx) {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '⏳ در حال تهیه پشتیبان کندو... لطفاً صبر کنید.',
    adminBackKeyboard,
  );
  try {
    const filePath = await adminService.generateDatabaseBackup();
    await ctx.replyWithDocument({ source: filePath });
    await safeEdit(ctx, '✅ پشتیبان کندو آماده شد.',
      Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت به مرکز کنترل', 'admin_back')]]),
    );
  } catch {
    await safeEdit(ctx, '❌ پشتیبان‌گیری انجام نشد.',
      adminBackKeyboard,
    );
  }
}

// ---------------------------------------------------------------------------
// 🏠 1. Dashboard
// ---------------------------------------------------------------------------

export async function handleAdminDashboard(ctx) {
  await ctx.answerCbQuery();
  try {
    const dash = await adminDashboardService.getDashboard();

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
      '🐝 *HORNET CONTROL CENTER*',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      `💰 شهد امروز: ${formatRials(dash.todayRevenue)}`,
      `🐝 کل زنبورها: \`${dash.totalUsers}\``,
      `🟢 زنبورهای فعال: \`${dash.activeSubscriptions}\``,
      `🍯 شهد امروز: \`${dash.todayBandwidthGB}\` GB`,
      `🏠 کندوهای سالم: \`${dash.serverHealthy}\`/\`${totalServers}\``,
      `⚠️ کندوهای نزدیک ظرفیت: \`${nearCapacity}\``,
    ];

    const dashboardActions = Markup.inlineKeyboard([
      [Markup.button.callback('📊 آمار', 'admin_metrics'),
       Markup.button.callback('🌐 کندوها', 'admin_servers')],
      [Markup.button.callback('🔙 مرکز کنترل', 'admin_back')],
    ]);

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...dashboardActions,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت داشبورد.', adminBackKeyboard);
  }
}

// ---------------------------------------------------------------------------
// 👤 2. User Management
// ---------------------------------------------------------------------------

export async function handleAdminUsers(ctx) {
  await ctx.answerCbQuery();
  try {
    const total = await User.countDocuments();
    const banned = await User.countDocuments({ role: 'banned' });
    const activeSubs = await Subscription.countDocuments({ status: 'active' });

    const lines = [
      '👤 *مدیریت زنبورها*',
      '',
      `🐝 کل زنبورها: \`${total}\``,
      `🟢 در حال پرواز: \`${activeSubs}\``,
      `❄️ منجمد شده: \`${banned}\``,
      '',
      '🔍 برای جستجو، شناسه تلگرام را ارسال کنید.',
    ];

    const userActions = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 ریست شهد همه', 'admin_user_reset_all')],
      [Markup.button.callback('🔙 مرکز کنترل', 'admin_back')],
    ]);

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...userActions,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت اطلاعات زنبورها.', adminBackKeyboard);
  }
}

export async function handleAdminUserResetAll(ctx) {
  await ctx.answerCbQuery();
  const subs = await Subscription.updateMany(
    { status: 'active' },
    { $set: { usedVolumeBytes: 0 } },
  );
    await safeEdit(ctx,
    `✅ شهد \`${subs.modifiedCount}\` زنبور فعال ریست شد.`,
    { parse_mode: 'Markdown', ...adminBackKeyboard },
  );
}

// ---------------------------------------------------------------------------
// 🌐 3. Server Management
// ---------------------------------------------------------------------------

export async function handleAdminServers(ctx) {
  await ctx.answerCbQuery();
  try {
    const servers = await adminServerService.getAllServers();

    if (servers.length === 0) {
      await safeEdit(ctx, '🏠 هیچ کندویی ثبت نشده.', adminBackKeyboard);
      return;
    }

    const lines = ['🏠 *مدیریت کندوها*', ''];
    for (const s of servers) {
      const statusIcon = s.status === 'active' ? '🟢' : '🔴';
      lines.push(
        `${statusIcon} *${s.name}*`,
        `   IP: \`${s.ipAddress}\` | زنبورها: \`${s.currentActiveUsers}\`/\`${s.maxCapacity}\``,
        `   بار: \`${s.loadPercent}%\` | وضعیت: ${s.status === 'active' ? '✅ فعال' : '🔧 تعمیرات'}`,
        '',
      );
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...adminBackKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت لیست کندوها.', adminBackKeyboard);
  }
}

// ---------------------------------------------------------------------------
// 📦 4. Plan Management
// ---------------------------------------------------------------------------

export async function handleAdminPlans(ctx) {
  await ctx.answerCbQuery();
  try {
    const plans = await adminPlanService.getAllPlans();

    if (plans.length === 0) {
      await safeEdit(ctx, '📦 هیچ پلنی تعریف نشده.', adminBackKeyboard);
      return;
    }

    const lines = ['📦 *مدیریت پلن‌ها*', ''];
    for (const p of plans) {
      const category = p.category ? ` [${p.category}]` : '';
      lines.push(
        `🔹 *${p.title}*${category}`,
        `   🍯 شهد: \`${p.baseVolumeGB}\` GB | مدت: \`${p.durationDays}\` روز`,
        `   💰 قیمت: ${formatRials(p.basePrice)} | زنبورها: \`${p.maxSubLinks}\``,
        `   وضعیت: ${p.isActive ? '✅ فعال' : '❌ غیرفعال'}`,
        '',
      );
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...adminBackKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت پلن‌ها.', adminBackKeyboard);
  }
}

// ---------------------------------------------------------------------------
// 💳 5. Financial Management
// ---------------------------------------------------------------------------

export async function handleAdminFinance(ctx) {
  await ctx.answerCbQuery();
  try {
    const now = new Date();
    const monthly = await adminFinanceService.getMonthlySales(
      now.getFullYear(),
      now.getMonth() + 1,
    );
    const dailySales = await adminFinanceService.getDailySales(1);
    const todayRevenue = dailySales.length > 0 ? dailySales[0].revenue : 0;
    const todayCount = dailySales.length > 0 ? dailySales[0].count : 0;

    const lines = [
      '🍯 *اقتصاد شهد*',
      '',
      `💰 شهد امروز: ${formatRials(todayRevenue)} (\`${todayCount}\` تراکنش)`,
      `📊 شهد ماهانه: ${formatRials(monthly.totalRevenue)} (\`${monthly.totalSales}\` تراکنش)`,
    ];

    const projection = await adminFinanceService.getRevenueProjection();
    lines.push(
      `📈 پیش‌بینی ۳ ماهه: ${formatRials(projection.projection3Months)}`,
    );

    const financeActions = Markup.inlineKeyboard([
      [Markup.button.callback('📅 فروش روزانه', 'admin_finance_daily')],
      [Markup.button.callback('🔙 مرکز کنترل', 'admin_back')],
    ]);

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...financeActions,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت اطلاعات مالی.', adminBackKeyboard);
  }
}

export async function handleAdminFinanceDaily(ctx) {
  await ctx.answerCbQuery();
  try {
    const daily = await adminFinanceService.getDailySales(7);
    const lines = ['📅 *فروش ۷ روز اخیر*', ''];
    for (const d of daily) {
      lines.push(`🔹 ${d._id} : ${formatRials(d.revenue)} (\`${d.count}\` فروش)`);
    }
    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...adminBackKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت فروش روزانه.', adminBackKeyboard);
  }
}

// ---------------------------------------------------------------------------
// 🤖 6. Bot Management
// ---------------------------------------------------------------------------

export async function handleAdminBot(ctx) {
  await ctx.answerCbQuery();
    const lines = [
    '🤖 *ربات ملکه*',
    '',
    '🔹 ارسال پیام همگانی به زنبورها',
    '🔹 مدیریت پیام‌های خودکار',
    '',
    'مخاطب مورد نظر را انتخاب کنید:',
  ];

  const botActions = Markup.inlineKeyboard([
    [Markup.button.callback('📢 همه زنبورها', 'admin_broadcast_all')],
    [Markup.button.callback('📢 زنبورهای فعال', 'admin_broadcast_active')],
    [Markup.button.callback('📢 زنبورهای منقضی', 'admin_broadcast_expired')],
    [Markup.button.callback('🔙 مرکز کنترل', 'admin_back')],
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
  const targetIds = await adminBotService.getBroadcastTargets(audience);

  const labels = { all: 'همه زنبورها', active: 'زنبورهای فعال', expired: 'زنبورهای منقضی' };

  const lines = [
    "📢 *فرمان ملکه*",
    '',
    `مخاطب: ${labels[audience] || audience}`,
    `تعداد: \`${targetIds.length}\` زنبور`,
    '',
    'برای ارسال پیام از API استفاده کنید:',
    '`POST /api/enterprise/bot/broadcast`',
  ];

  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...adminBackKeyboard,
  });
}

// ---------------------------------------------------------------------------
// ⚡ 7. Smart Bandwidth Manager
// ---------------------------------------------------------------------------

export async function handleAdminBandwidth(ctx) {
  await ctx.answerCbQuery();
  try {
    const actions = await adminBandwidthService.getLoadAwareScalingActions();

    const lines = ['⚡ *مدیریت بال‌ها*', ''];

    const servers = await Server.find({ status: 'active' }).lean();
    if (servers.length === 0) {
      lines.push('هیچ کندوی فعالی یافت نشد.');
    } else {
      lines.push('📊 *بار کندوها:*');
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
      lines.push('🧠 *توصیه هوش مصنوعی ملکه:*');
      for (const a of actions) {
        lines.push(`🔸 ${a.serverName}: بار \`${a.loadPercent}%\` — ${a.suggestedAction}`);
      }
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...adminBackKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت اطلاعات بال‌ها.', adminBackKeyboard);
  }
}

// ---------------------------------------------------------------------------
// 🔐 8. Security & Audit
// ---------------------------------------------------------------------------

export async function handleAdminSecurity(ctx) {
  await ctx.answerCbQuery();
  try {
    const logs = await adminLogService.getLogs({}, 1, 10);

    const lines = [
      '🛡️ *امنیت کندو*',
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
      ...adminBackKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت لاگ‌ها.', adminBackKeyboard);
  }
}

// ---------------------------------------------------------------------------
// 📊 9. Analytics & BI
// ---------------------------------------------------------------------------

export async function handleAdminAnalytics(ctx) {
  await ctx.answerCbQuery();
  try {
    const [retention, churn, popularity] = await Promise.all([
      adminAnalyticsService.getRetentionRate(),
      adminAnalyticsService.getChurnRate(),
      adminAnalyticsService.getServerPopularity(),
    ]);

    const lines = [
      '🧠 *هوش مصنوعی ملکه*',
      '',
      `📈 نرخ ماندگاری: \`${retention.retentionRate}%\` (\`${retention.activeUsers}\` فعال از \`${retention.totalUsers}\`)`,
      `📉 نرخ ریزش: \`${churn.churnRate}%\` (\`${churn.churnedLast30}\` ریزش در ۳۰ روز)`,
      '',
      '🌟 *محبوبیت کندوها:*',
    ];

    for (const s of popularity) {
      lines.push(`🔹 ${s.serverName}: \`${s.subscriberCount}\` زنبور`);
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...adminBackKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت آنالیتیکس.', adminBackKeyboard);
  }
}

// ---------------------------------------------------------------------------
// 🛠️ 10. Ticket / Support
// ---------------------------------------------------------------------------

export async function handleAdminTickets(ctx) {
  await ctx.answerCbQuery();
  try {
    const open = await Ticket.countDocuments({ status: 'open' });
    const answered = await Ticket.countDocuments({ status: 'answered' });
    const closed = await Ticket.countDocuments({ status: 'closed' });

    const lines = [
      "🆘 *پشتیبانی ملکه*",
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
        const statusIcon = t.status === 'open' ? '🟡' : t.status === 'answered' ? '💬' : '✅';
        lines.push(`${statusIcon} ${user} — \`${t.status}\``);
      }
    }

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...adminBackKeyboard,
    });
  } catch {
    await safeEdit(ctx, '❌ خطا در دریافت تیکت‌ها.', adminBackKeyboard);
  }
}

// ---------------------------------------------------------------------------
// Receipt review action handler
// ---------------------------------------------------------------------------

export async function handleReceiptAction(ctx) {
  await ctx.answerCbQuery();

  const action = ctx.match[1];
  const receiptId = ctx.match[2];

  try {
    const admin = await resolveUser(ctx.from.id);
    const receipt = await paymentService.processReceipt(receiptId, admin._id, action);

    if (action === 'approve') {
      const lines = [
        '✅ *رسید شهد تأیید شد*',
        '',
        `🔹 رسید: \`${receipt._id}\``,
        `🔹 مبلغ: ${formatRials(receipt.amount)}`,
      ];

      await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown' });

      const userDoc = await User.findById(receipt.userId);
      if (userDoc) {
        const notifyLines = [
          '✅ *پرداخت شهد تأیید شد*',
          '',
          '🍯 مبلغ: ' + formatRials(receipt.amount),
          '💰 مخزن شهد: ' + formatRials(userDoc.walletBalance),
          '',
          '🐝 بال‌های شما آماده است. از کندو ارتقاء دهید.',
        ];

        await ctx.telegram.sendMessage(
          userDoc.telegramId,
          notifyLines.join('\n'),
          { parse_mode: 'Markdown' },
        );
      }
    } else {
      await safeEdit(ctx,
        '❌ *رسید شهد رد شد*\n\n🆔 `' + receipt._id + '`',
        { parse_mode: 'Markdown' },
      );

      const userDoc = await User.findById(receipt.userId);
      if (userDoc) {
        const notifyLines = [
          '❌ *پرداخت شهد رد شد*',
          '',
          '🔹 رسید: `' + receipt._id + '`',
          '',
          'رسید شما قابل تأیید نبود.',
          'با پشتیبانی ملکه تماس بگیرید.',
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

// ---------------------------------------------------------------------------
// User navigation handlers
// ---------------------------------------------------------------------------

export async function handleMainMenu(ctx) {
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
}

export async function showMainMenu(ctx, prefix) {
  const msg = prefix ?? '🐝 *HORNET NEST*\n\nیک گزینه را انتخاب کنید:';
  if (ctx.callbackQuery) {
    await safeEdit(ctx, msg, { parse_mode: 'Markdown', ...mainMenuKeyboard });
  } else {
    await ctx.replyWithMarkdown(msg, mainMenuKeyboard);
  }
}

export async function handleProfile(ctx) {
  await ctx.answerCbQuery();
  const user = await resolveUser(ctx.from.id);

  const [activeSubs, totalUsageResult] = await Promise.all([
    Subscription.countDocuments({ ownerId: user._id, status: 'active' }),
    Subscription.aggregate([
      { $match: { ownerId: user._id, status: 'active' } },
      { $group: { _id: null, totalUsed: { $sum: '$usedVolumeBytes' } } },
    ]),
  ]);

  const totalUsedGB = totalUsageResult[0]
    ? (totalUsageResult[0].totalUsed / GB).toFixed(2)
    : '0.00';

  const roleLabel = { user: '🐝 کارگر', support: '🛡️ نگهبان', superadmin: '👑 ملکه' };
  const rankDisplay = formatRank(user.rank);
  const honeyBar = activeSubs > 0 ? '🍯' + '█'.repeat(Math.min(activeSubs, 10)) + '░'.repeat(Math.max(0, 10 - activeSubs)) : '🍯 کندوی فعالی ندارید';

  const lines = [
    '📊 *وضعیت پرواز*',
    '',
    `🐝 زنبور: \`${user.telegramId}\``,
    `👑 رتبه: ${rankDisplay}`,
    `💰 مخزن شهد: ${formatRials(user.walletBalance)}`,
    `📅 عضویت: ${formatDate(user.joinedAt)}`,
    `🎁 کد هدیه: \`${user.referralCode || '—'}\``,
    '',
    `⚡ *وضعیت بال‌ها*`,
    `🟢 کندوهای فعال: ${activeSubs}`,
    `🍯 کل شهد مصرفی: ${totalUsedGB} GB`,
    `${honeyBar}`,
  ];

  const dashboardKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🏠 کندوی من', 'my_subscriptions')],
    [Markup.button.callback('🔙 HORNET NEST', 'main_menu')],
  ]);

  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...dashboardKeyboard,
  });
}

// ---------------------------------------------------------------------------
// Category-based plan listing
// ---------------------------------------------------------------------------

export async function handleBuyRenew(ctx) {
  await ctx.answerCbQuery();

  const categories = await Plan.distinct('category', {
    isActive: true,
    isTrial: { $ne: true },
  });

  if (categories.length === 0) {
    await safeEdit(ctx,
      '⚠️ هیچ پلنی برای خرید موجود نیست. بعداً مراجعه کنید.',
      Markup.inlineKeyboard([[Markup.button.callback('🔙 HORNET NEST', 'main_menu')]]),
    );
    return;
  }

  const lines = [
    '⚡ *ارتقاء بال‌ها*',
    '',
    'دسته مورد نظر را انتخاب کنید:',
  ];

  const buttons = categories.map((cat) => [
    Markup.button.callback(cat, `category_${cat}`),
  ]);
  buttons.push([Markup.button.callback('🔙 HORNET NEST', 'main_menu')]);

  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

export async function handleCategorySelection(ctx) {
  await ctx.answerCbQuery();

  const category = ctx.match[1];

  const plans = await Plan.find({
    category,
    isActive: true,
    isTrial: { $ne: true },
  }).lean();

  if (plans.length === 0) {
    await safeEdit(ctx,
      '⚠️ در این دسته پلنی موجود نیست. دسته دیگری را انتخاب کنید.',
      Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت به دسته‌ها', 'buy_renew')]]),
    );
    return;
  }

  const lines = [`📁 *${category}*`, ''];
  const buttons = [];

  for (const plan of plans) {
    lines.push(
      `🔹 *${plan.title}*`,
      `   🍯 شهد: ${plan.baseVolumeGB} GB  |  مدت: ${plan.durationDays} روز`,
      `   💰 قیمت: ${formatRials(plan.basePrice)}`,
      `   👥 زنبورها: ${plan.maxSubLinks}`,
      '',
    );
    buttons.push([Markup.button.callback(`⚡ ${plan.title}`, `select_plan_${plan._id}`)]);
  }

  buttons.push([Markup.button.callback('🔙 بازگشت به دسته‌ها', 'buy_renew')]);

  await safeEdit(ctx, lines.join('\n'), {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

// ---------------------------------------------------------------------------
// Subscription display
// ---------------------------------------------------------------------------

export async function handleMySubscriptions(ctx) {
  await ctx.answerCbQuery();

  try {
    const user = await resolveUser(ctx.from.id);
    const subs = await Subscription.find({ ownerId: user._id })
      .populate('planId')
      .populate('serverId')
      .sort({ createdAt: -1 })
      .lean();

    if (subs.length === 0) {
      await safeEdit(ctx,
        '📭 کندوی شما خالی است. برای شروع بال‌های خود را ارتقاء دهید!',
        Markup.inlineKeyboard([[Markup.button.callback('⚡ ارتقاء بال‌ها', 'buy_renew')]]),
      );
      return;
    }

    const activeSub = subs.find((s) => s.status === 'active');
    if (!activeSub) {
      const expiredLines = subs
        .map((s) => `🔹 وضعیت: ${s.status === 'expired' ? '🔴 منقضی' : s.status} — تاریخ: ${formatDate(s.expireDate)}`)
        .join('\n');

      await safeEdit(ctx,
        '⏰ کندوی شما منقضی شده است.\n\n' + expiredLines,
        Markup.inlineKeyboard([
          [Markup.button.callback('⚡ ارتقاء بال‌ها', 'buy_renew')],
          [Markup.button.callback('🔙 HORNET NEST', 'main_menu')],
        ]),
      );
      return;
    }

    const summary = await getSubscriptionSummary(activeSub, activeSub.planId, activeSub.serverId);
    await safeEdit(ctx, summary, {
      parse_mode: 'Markdown',
      ...subscriptionActionsKeyboard(),
    });
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

export async function handleCreateSubLink(ctx) {
  await ctx.answerCbQuery();

  try {
    const user = await resolveUser(ctx.from.id);
    const sub = await Subscription.findOne({ ownerId: user._id, status: 'active' });

    if (!sub) {
      await safeEdit(ctx,
        '❌ کندوی فعالی ندارید. ابتدا بال‌های خود را ارتقاء دهید.',
        Markup.inlineKeyboard([[Markup.button.callback('⚡ ارتقاء بال‌ها', 'buy_renew')]]),
      );
      return;
    }

    await ctx.scene.enter('create-sublink');
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ---------------------------------------------------------------------------
// Plan selection & checkout
// ---------------------------------------------------------------------------

export async function handlePlanSelection(ctx) {
  await ctx.answerCbQuery();

  try {
    const planId = ctx.match[1];
    const [plan, user] = await Promise.all([
      Plan.findById(planId).lean(),
      resolveUser(ctx.from.id),
    ]);

    if (!plan || !plan.isActive) {
      await safeEdit(ctx,
        '⚠️ این پلن در دسترس نیست.',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'buy_renew')]]),
      );
      return;
    }

    const sufficient = user.walletBalance >= plan.basePrice;

    const invoiceLines = [
      '⚡ *مشخصات پلن*',
      '',
      `📋 پلن: *${plan.title}*`,
      `🍯 شهد: ${plan.baseVolumeGB} GB`,
      `📅 مدت: ${plan.durationDays} روز`,
      `👥 زنبورها: ${plan.maxSubLinks}`,
      '',
      `💰 قیمت: ${formatRials(plan.basePrice)}`,
      `🍯 مخزن شهد شما: ${formatRials(user.walletBalance)}`,
      '',
      sufficient ? '✅ شهد کافی است.' : '⚠️ شهد کافی نیست. مخزن خود را شارژ کنید.',
    ];

    const buttons = [
      [Markup.button.callback('✅ پرداخت با شهد', `checkout_${plan._id}`)],
      [Markup.button.callback('💳 پرداخت کارتی', `cardpay_${plan._id}`)],
      [Markup.button.callback('⚡️ پرداخت خودکار', `autocardpay_${plan._id}`)],
      [Markup.button.callback('🔙 بازگشت', 'buy_renew')],
    ];

    await safeEdit(ctx, invoiceLines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

export async function handleCardPayment(ctx) {
  await ctx.answerCbQuery();

  const planId = ctx.match[1];
  await ctx.scene.enter('receipt-upload', { planId });
}

export async function handleAutoCardPayment(ctx) {
  await ctx.answerCbQuery();

  try {
    const planId = ctx.match[1];
    const [plan, user] = await Promise.all([
      Plan.findById(planId).lean(),
      resolveUser(ctx.from.id),
    ]);

    if (!plan || !plan.isActive) {
      await safeEdit(ctx,
        '⚠️ پلن در دسترس نیست.',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'buy_renew')]]),
      );
      return;
    }

    const exactAmount = await paymentService.generateUniqueAmount(plan.basePrice);
    const cardNumber = await Setting.get('cardNumber', '۵۰۲۲-۲۹۱۰-XXXX-XXXX');

    await Receipt.create({
      userId: user._id,
      planId: plan._id,
      amount: exactAmount,
      photoFileId: 'auto',
      status: 'pending',
    });

    const lines = [
      '⚡️ *پرداخت خودکار کارت به کارت*',
      '',
      '🔹 پلن: *' + plan.title + '*',
      '🔹 مبلغ: ' + formatRials(exactAmount),
      '',
      '💳 *شماره کارت:*',
      '`' + cardNumber + '`',
      '',
      '📌 *نکات مهم:*',
      '🔹 مبلغ دقیقاً به همین میزان واریز شود.',
      '🔹 سیستم کمتر از یک دقیقه تأیید می‌کند.',
      '',
      '⚠️ مبلغ نادرست تأیید خودکار نمی‌شود.',
    ];

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⚡ ارتقاء بال‌ها', 'buy_renew')],
        [Markup.button.callback('🔙 HORNET NEST', 'main_menu')],
      ]),
    });
  } catch (error) {
    await ctx.reply(formatError(error));
    await showMainMenu(ctx);
  }
}

export async function handleCheckout(ctx) {
  await ctx.answerCbQuery();

  if (ctx.session?.isProcessing) {
    await ctx.answerCbQuery('⏳ لطفاً صبر کنید...');
    return;
  }

  if (!ctx.session) ctx.session = {};
  ctx.session.isProcessing = true;

  try {
    const planId = ctx.match[1];
    const user = await resolveUser(ctx.from.id);

    const sub = await subscriptionService.createSubscription(user._id, planId);

    const updatedUser = await User.findById(user._id);
    const rankLabel = formatRank(updatedUser.rank);

    const lines = [
      '✅ *بال‌ها ارتقاء یافت!*',
      '',
      `👑 رتبه: ${rankLabel}`,
      '',
      'از بخش «کندوی من» لینک اختصاصی خود را بسازید.',
      '',
      '🐝 پرواز خوش!',
    ];

    await safeEdit(ctx, lines.join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('🏠 کندوی من', 'my_subscriptions')],
        [Markup.button.callback('🔙 HORNET NEST', 'main_menu')],
      ]),
    );
  } catch (error) {
    const msg = formatError(error);

    if (error instanceof InsufficientBalanceError) {
      await safeEdit(ctx,
        msg + '\n\n🔻 مخزن شهد خود را شارژ کنید:',
        Markup.inlineKeyboard([
          [Markup.button.callback('💳 پرداخت کارتی', 'recharge_wallet')],
          [Markup.button.callback('🔙 بازگشت', 'buy_renew')],
        ]),
      );
      return;
    }

    await safeEdit(ctx, msg,
      Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'buy_renew')]]),
    );
  } finally {
    if (ctx.session) {
      ctx.session.isProcessing = false;
    }
  }
}

export async function handleMockRecharge(ctx) {
  await ctx.answerCbQuery();

  const user = await resolveUser(ctx.from.id);
  user.walletBalance += 1_000_000;
  await user.save();

  const lines = [
    '✅ *مخزن شهد شارژ شد*',
    '',
    `💰 موجودی جدید: ${formatRials(user.walletBalance)}`,
    '',
    'بال‌های شما آماده است. هم‌اکنون ارتقاء دهید!',
  ];

  await safeEdit(ctx, lines.join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('⚡ ارتقاء بال‌ها', 'buy_renew')],
      [Markup.button.callback('🔙 HORNET NEST', 'main_menu')],
    ]),
    { parse_mode: 'Markdown' },
  );
}

// ---------------------------------------------------------------------------
// Free trial
// ---------------------------------------------------------------------------

export async function handleFreeTrial(ctx) {
  await ctx.answerCbQuery();

  try {
    const isMember = await checkChannelMembership(ctx);
    if (!isMember) {
      const channelId = process.env.CHANNEL_ID;

      const lines = [
        '🔒 *هدیه شهد — عضویت در کانال*',
        '',
        'برای دریافت هدیه رایگان، در کانال ما عضو شوید:',
        '',
        channelId ? '👉 @' + channelId.replace('@', '') : '',
        '',
        'پس از عضویت، گزینه «بررسی مجدد» را انتخاب کنید.',
      ];

      await safeEdit(ctx, lines.join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.url('📢 عضویت در کانال', `https://t.me/${channelId?.replace('@', '') || ''}`)],
          [Markup.button.callback('🔄 بررسی مجدد', 'free_trial')],
          [Markup.button.callback('🔙 بازگشت', 'main_menu')],
        ]),
      );
      return;
    }

    const user = await resolveUser(ctx.from.id);

    const trialPlan = await Plan.findOne({ isTrial: true, isActive: true }).lean();
    if (!trialPlan) {
      await safeEdit(ctx,
        '⚠️ هدیه شهد در حال حاضر در دسترس نیست.',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'main_menu')]]),
      );
      return;
    }

    const existingTrial = await Subscription.findOne({
      ownerId: user._id,
      planId: trialPlan._id,
    });

    if (existingTrial) {
      await safeEdit(ctx,
        '⏳ شما قبلاً هدیه شهد خود را دریافت کرده‌اید.\n' +
        'برای خرید از بخش ارتقاء بال‌ها اقدام کنید.',
        Markup.inlineKeyboard([[Markup.button.callback('⚡ ارتقاء بال‌ها', 'buy_renew')]]),
      );
      return;
    }

    await subscriptionService.createSubscription(user._id, trialPlan._id);

    const lines = [
      '🎉 *هدیه شهد دریافت شد!*',
      '',
      '🍯 شهد: ۵۰۰ مگابایت',
      '📅 مدت: ۱ روز',
      '',
      'از بخش «کندوی من» لینک اختصاصی خود را بسازید.',
      '',
      '🐝 به کندو خوش آمدید!',
    ];

    await safeEdit(ctx, lines.join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('🏠 کندوی من', 'my_subscriptions')],
        [Markup.button.callback('🔙 HORNET NEST', 'main_menu')],
      ]),
    );
  } catch (error) {
    const msg = formatError(error);
    await safeEdit(ctx, msg,
      Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'main_menu')]]),
    );
  }
}
