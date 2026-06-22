/**
 * userController.js
 *
 * Handles all end-user bot interactions.
 * Admin actions are fully separated in adminController.js.
 *
 * New in this version:
 *  - Dynamic panels via generateUserPanel(user, sub)
 *  - Client-type picker → generateClientPickerKeyboard(subId)
 *  - SmartSubscriptionService for per-client config delivery
 *  - on_hold status displayed correctly
 */

import UserService from '../../services/UserService.js';
import PlanService from '../../services/PlanService.js';
import SubscriptionService from '../../services/SubscriptionService.js';
import PaymentService from '../../services/PaymentService.js';
import SmartSubscriptionService from '../../services/SmartSubscriptionService.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import TunnelConfigRepository from '../../repositories/TunnelConfigRepository.js';
import SettingRepository from '../../repositories/SettingRepository.js';
import Subscription from '../../models/Subscription.js';
import { Markup } from 'telegraf';
import { formatRials, formatBytes, formatDate, formatError } from '../utils.js';
import {
  mainMenuKeyboard,
  generateUserPanel,
  generateClientPickerKeyboard,
  subscriptionActionsKeyboard,
  generatePlansKeyboard,
} from '../keyboards.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err?.description?.includes('message is not modified')) return;
    throw err;
  }
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

// Maps subscription status to a human-readable Farsi label + emoji
function subStatusLabel(status) {
  const map = {
    active:               '✅ فعال',
    on_hold:              '⏳ در انتظار اتصال',
    expired:              '⚠️ منقضی شده',
    suspended:            '🚫 معلق',
    cancelled:            '❌ لغو شده',
    pending_payment:      '💳 در انتظار پرداخت',
    pending_shared_payment: '💳 پرداخت مشترک',
    trial:                '🎁 آزمایشی',
  };
  return map[status] || status;
}

export async function getSubscriptionSummary(sub, plan, server) {
  const remaining   = sub.remainingVolumeBytes ?? Math.max(0, sub.totalVolumeBytes - sub.usedVolumeBytes);
  const usagePercent = sub.totalVolumeBytes > 0
    ? ((sub.usedVolumeBytes / sub.totalVolumeBytes) * 100).toFixed(1)
    : '0.0';

  const planTitle  = plan?.title || 'طرح';
  const serverName = server?.name || '—';

  const lines = [
    `${subStatusLabel(sub.status)} *${planTitle}*`,
    `💾 مصرف: ${formatBytes(sub.usedVolumeBytes)} از ${formatBytes(sub.totalVolumeBytes)} (${usagePercent}%)`,
    `📋 باقی‌مانده: ${formatBytes(remaining)}`,
    `🖥 سرور: ${serverName}`,
  ];

  if (sub.status === 'on_hold') {
    lines.push('ℹ️ تایمر اشتراک پس از اولین اتصال آغاز می‌شود.');
  } else {
    lines.push(`📅 شروع: ${formatDate(sub.activatedAt || sub.startDate)}`);
    lines.push(`📅 انقضا: ${formatDate(sub.expireDate)}`);
  }

  return lines.join('\n');
}

// ─── /start ───────────────────────────────────────────────────────────────────

export async function startCommand(ctx) {
  try {
    const referralCode = ctx.payload?.trim().toUpperCase() || null;
    ctx.user = await UserService.resolveUser(ctx.from.id, referralCode);

    const isMember = await checkChannelMembership(ctx);
    if (!isMember) {
      const channelId = process.env.CHANNEL_ID;
      return ctx.replyWithMarkdown(
        '🚫 *خوش آمدید*\n\n' +
        'برای استفاده از خدمات HORNET، لطفاً ابتدا در کانال ما عضو شوید:\n\n' +
        (channelId ? `👉 [عضویت در کانال](https://t.me/${channelId.replace('@', '')})` : ''),
      );
    }

    const user = ctx.user;
    // Fetch most-relevant subscription for dynamic panel
    const sub  = await SubscriptionRepository.findActiveByOwner(user._id)
               ?? await SubscriptionRepository.findOne({ ownerId: user._id, status: 'on_hold' })
               ?? await SubscriptionRepository.findOne({ ownerId: user._id }, { sort: { createdAt: -1 } });

    const welcomeLines = [
      '🔹 *HORNET*',
      '',
      `خوش آمدید ${user.telegramId} عزیز`,
      `📊 سطح: ${user.rank || 'کاربر'}`,
      `💰 اعتبار: ${formatRials(user.walletBalance)}`,
      '',
      'لطفاً یکی از گزینه‌های زیر را انتخاب کنید:',
    ];

    await ctx.replyWithMarkdown(welcomeLines.join('\n'), generateUserPanel(user, sub));
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ─── Main menu ────────────────────────────────────────────────────────────────

export async function handleMainMenu(ctx) {
  try {
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const sub  = await SubscriptionRepository.findActiveByOwner(user._id)
               ?? await SubscriptionRepository.findOne({ ownerId: user._id, status: 'on_hold' });

    const text = '🔹 *HORNET*\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:';
    const kb   = generateUserPanel(user, sub);

    if (ctx.callbackQuery?.message) {
      await safeEdit(ctx, text, { parse_mode: 'Markdown', ...kb });
      await ctx.answerCbQuery();
    } else {
      await ctx.replyWithMarkdown(text, kb);
    }
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function handleProfile(ctx) {
  try {
    const user       = ctx.user || await UserService.resolveUser(ctx.from.id);
    const activeCount = await SubscriptionRepository.countByOwnerAndStatus(user._id, 'active');
    const holdCount   = await SubscriptionRepository.countByOwnerAndStatus(user._id, 'on_hold');

    const lines = [
      '📊 *وضعیت حساب کاربری*',
      '',
      `🆔 شناسه: \`${user.telegramId}\``,
      `📊 سطح: ${user.rank || 'کاربر'}`,
      `💰 اعتبار: ${formatRials(user.walletBalance)}`,
      `💸 مجموع هزینه: ${formatRials(user.totalSpent || 0)}`,
      `📡 اشتراک فعال: ${activeCount}`,
      holdCount > 0 ? `⏳ در انتظار اتصال: ${holdCount}` : '',
      `🔗 کد معرف: \`${user.referralCode || '—'}\``,
      '',
      '🔹 HORNET',
    ].filter(Boolean);

    if (ctx.callbackQuery?.message) {
      await safeEdit(ctx, lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
    } else {
      await ctx.replyWithMarkdown(lines.join('\n'), mainMenuKeyboard);
    }
    await ctx.answerCbQuery?.();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ─── Buy / Renew ──────────────────────────────────────────────────────────────

export async function handleBuyRenew(ctx) {
  try {
    const categories = await PlanService.getCategories();
    if (!categories || categories.length === 0) {
      await safeEdit(ctx, '❌ در حال حاضر هیچ طرحی موجود نیست.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const keyboard = Markup.inlineKeyboard([
      ...categories.map(cat => [Markup.button.callback(cat, `category_${cat}`)]),
      [Markup.button.callback('🔙 بازگشت', 'main_menu')],
    ]);

    await safeEdit(ctx, '⚡ *خرید اشتراک*\n\nدسته‌بندی مورد نظر را انتخاب کنید:', {
      parse_mode: 'Markdown',
      ...keyboard,
    });
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

export async function handleCategorySelection(ctx) {
  try {
    const category = ctx.match[1];
    const plans    = await PlanService.getPlansByCategory(category);

    if (!plans || plans.length === 0) {
      await safeEdit(ctx, `❌ هیچ طرحی در دسته "${category}" یافت نشد.`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 بازگشت', 'buy_renew')],
        ]).reply_markup,
      });
      return;
    }

    const keyboard = generatePlansKeyboard(plans, formatRials);
    await safeEdit(ctx, `📁 *دسته: ${category}*\n\nطرح مورد نظر را انتخاب کنید:`, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ─── My subscriptions ─────────────────────────────────────────────────────────

export async function handleMySubscriptions(ctx) {
  try {
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const subs = await SubscriptionRepository.findByOwner(user._id);

    if (!subs || subs.length === 0) {
      const text = '📋 *اشتراک‌های من*\n\nشما هیچ اشتراکی ندارید.\nاز گزینه "خرید اشتراک" یک طرح انتخاب کنید.';
      await safeEdit(ctx, text, {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const lines        = ['📋 *اشتراک‌های من*', ''];
    const populatedSubs = await Subscription.find({ _id: { $in: subs.map(s => s._id) } })
      .populate('planId')
      .populate('serverId');

    // Pick the "best" subscription for the dynamic panel
    const activeSub = populatedSubs.find(s => s.status === 'active')
                   ?? populatedSubs.find(s => s.status === 'on_hold')
                   ?? populatedSubs[0];

    for (const sub of populatedSubs) {
      lines.push('─'.repeat(15));
      lines.push(await getSubscriptionSummary(sub, sub.planId, sub.serverId));
    }
    lines.push('', '🔹 HORNET');

    const kb = activeSub
      ? subscriptionActionsKeyboard()
      : mainMenuKeyboard;

    if (ctx.callbackQuery?.message) {
      await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...kb });
    } else {
      await ctx.replyWithMarkdown(lines.join('\n'), kb);
    }
    await ctx.answerCbQuery?.();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ─── Create sub-link ──────────────────────────────────────────────────────────

export async function handleCreateSubLink(ctx) {
  try {
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const sub  = await SubscriptionRepository.findActiveByOwner(user._id);
    if (!sub) {
      await ctx.answerCbQuery('❌ اشتراک فعالی ندارید.', { show_alert: true });
      return;
    }
    return ctx.scene.enter('create-sublink');
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ─── Get Config — client picker step 1 ───────────────────────────────────────

/**
 * Step 1: user taps "دریافت پیکربندی" → show client-type picker.
 */
export async function handleGetConfig(ctx) {
  try {
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const sub  = await SubscriptionRepository.findActiveByOwner(user._id);

    if (!sub) {
      await ctx.answerCbQuery('❌ اشتراک فعالی ندارید.', { show_alert: true });
      return;
    }

    // Find the first active tunnel config (sub-link)
    const tunnelConfig = await TunnelConfigRepository.findOne({
      subscriptionId: sub._id,
      isActive: true,
    });

    if (!tunnelConfig) {
      await ctx.answerCbQuery('❌ ابتدا یک لینک بسازید.', { show_alert: true });
      return;
    }

    await safeEdit(
      ctx,
      '📱 *انتخاب نرم‌افزار*\n\nبرای دریافت پیکربندی، نرم‌افزار VPN خود را انتخاب کنید:',
      {
        parse_mode: 'Markdown',
        ...generateClientPickerKeyboard(tunnelConfig.uuid),
      },
    );
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

/**
 * Step 2: user picks a client → deliver config in the correct format.
 * Action pattern: config_client_<clientKey>_<uuid>
 *
 * clientKey → User-Agent string passed to SmartSubscriptionService:
 *   v2rayng   → '' (Base64 fallback)
 *   singbox   → 'sing-box/1.0'
 *   clash     → 'ClashX/1.0'
 *   clashmeta → 'Clash Meta/1.0'
 */
export async function handleConfigClientPick(ctx) {
  try {
    // match[1] = clientKey, match[2] = uuid
    const clientKey = ctx.match[1];
    const uuid      = ctx.match[2];

    const UA_MAP = {
      v2rayng:   '',
      singbox:   'sing-box/1.0',
      clash:     'ClashX/1.0',
      clashmeta: 'Clash Meta/1.0',
    };

    const userAgent = UA_MAP[clientKey] ?? '';
    const result    = await SmartSubscriptionService.render(uuid, userAgent);

    if (!result) {
      await ctx.answerCbQuery('❌ پیکربندی یافت نشد.', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery();

    // Send the config as a file so users can import it directly
    const clientNames = {
      v2rayng:   'V2RayNG',
      singbox:   'Sing-Box',
      clash:     'Clash',
      clashmeta: 'Clash Meta',
    };

    const clientName = clientNames[clientKey] || 'VPN';
    const fileName   = `hornet-${clientKey}-${uuid.slice(0, 8)}.${result.format === 'clash' ? 'yaml' : result.format === 'singbox' ? 'json' : 'txt'}`;

    await ctx.replyWithDocument(
      {
        source: Buffer.from(result.body, 'utf-8'),
        filename: fileName,
      },
      {
        caption: `⚡ *پیکربندی ${clientName}*\n\n📥 فایل را دانلود کنید و به ${clientName} وارد کنید.`,
        parse_mode: 'Markdown',
        ...mainMenuKeyboard,
      },
    );
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ─── Plan selection & checkout ────────────────────────────────────────────────

export async function handlePlanSelection(ctx) {
  try {
    const planId = ctx.match[1];
    const plan   = await PlanService.getPlanById(planId);
    if (!plan) {
      await safeEdit(ctx, '❌ طرح مورد نظر یافت نشد.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const vol = plan.baseVolumeGB > 0 ? `${plan.baseVolumeGB} GB` : '♾ نامحدود';
    const dur = plan.durationDays >= 30
      ? `${Math.floor(plan.durationDays / 30)} ماه`
      : `${plan.durationDays} روز`;

    const lines = [
      `📦 *${plan.title}*`, '',
      `📁 دسته: ${plan.category}`,
      `💾 حجم: ${vol}`,
      `📅 مدت: ${dur}`,
      `🔗 حداکثر لینک: ${plan.maxSubLinks}`,
      `💰 قیمت: ${formatRials(plan.basePrice)}`,
      '',
      'آیا مایل به ادامه هستید؟',
    ];

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ ادامه به پرداخت', `checkout_${plan._id}`)],
        [Markup.button.callback('🔙 بازگشت',          'buy_renew')],
      ]),
    });
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

export async function handleCheckout(ctx) {
  try {
    const planId = ctx.match[1];
    const user   = ctx.user || await UserService.resolveUser(ctx.from.id);
    const plan   = await PlanService.getPlanById(planId);
    if (!plan) {
      await safeEdit(ctx, '❌ طرح مورد نظر یافت نشد.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const balance = user.walletBalance;
    const price   = plan.basePrice;
    const lines   = [
      '🧾 *تسویه حساب*', '',
      `📦 طرح: ${plan.title}`,
      `💰 مبلغ: ${formatRials(price)}`,
      `💳 اعتبار: ${formatRials(balance)}`,
      '',
    ];

    let kb;
    if (balance >= price) {
      lines.push('✅ موجودی کافی است. روش پرداخت را انتخاب کنید:');
      kb = Markup.inlineKeyboard([
        [Markup.button.callback('💳 پرداخت از اعتبار',  `checkout_confirm_${plan._id}`)],
        [Markup.button.callback('🏦 کارت به کارت',      `cardpay_${plan._id}`)],
        [Markup.button.callback('🔙 لغو',               'buy_renew')],
      ]);
    } else {
      lines.push(`❌ اعتبار کافی ندارید. کسری: ${formatRials(price - balance)}`);
      kb = Markup.inlineKeyboard([
        [Markup.button.callback('🏦 کارت به کارت', `cardpay_${plan._id}`)],
        [Markup.button.callback('🔙 لغو',          'buy_renew')],
      ]);
    }

    await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...kb });
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

export async function handleCheckoutConfirm(ctx) {
  try {
    const planId = ctx.match[1];
    const user   = ctx.user || await UserService.resolveUser(ctx.from.id);
    const plan   = await PlanService.getPlanById(planId);
    if (!plan) {
      await safeEdit(ctx, '❌ طرح یافت نشد.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    await SubscriptionService.createSubscription(user._id, plan._id);

    const vol = plan.baseVolumeGB > 0 ? `${plan.baseVolumeGB} GB` : '♾ نامحدود';
    const dur = plan.durationDays >= 30
      ? `${Math.floor(plan.durationDays / 30)} ماه`
      : `${plan.durationDays} روز`;

    await safeEdit(ctx, [
      '✅ *پرداخت با موفقیت انجام شد*', '',
      `📦 طرح: ${plan.title}`,
      `💾 حجم: ${vol}`,
      `📅 مدت: ${dur}`,
      `💰 مبلغ: ${formatRials(plan.basePrice)}`,
      '',
      '⏳ اشتراک شما آماده است — تایمر پس از اولین اتصال شروع می‌شود.',
      '🔹 HORNET',
    ].join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard.reply_markup,
    });
    await ctx.answerCbQuery();
  } catch (error) {
    const msg = error?.constructor?.name === 'InsufficientBalanceError'
      ? '❌ اعتبار کافی ندارید.'
      : `❌ خطا در پرداخت: ${error.message}`;
    await safeEdit(ctx, msg, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard.reply_markup,
    });
  }
}

// ─── Card payment ─────────────────────────────────────────────────────────────

export async function handleCardPayment(ctx) {
  try {
    const planId = ctx.match[1];
    const plan   = await PlanService.getPlanById(planId);
    if (!plan) { await ctx.reply('❌ طرح یافت نشد.'); return; }
    ctx.session = ctx.session || {};
    ctx.session.pendingPayment = { planId: plan._id.toString(), amount: plan.basePrice };
    return ctx.scene.enter('receipt-upload');
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

export async function handleAutoCardPayment(ctx) {
  try {
    const planId = ctx.match[1];
    const user   = ctx.user || await UserService.resolveUser(ctx.from.id);
    const plan   = await PlanService.getPlanById(planId);
    if (!plan) { await ctx.reply('❌ طرح یافت نشد.'); return; }

    const cardNumber   = await SettingRepository.get('cardNumber', '5022-2910-XXXX-XXXX');
    const uniqueAmount = await PaymentService.generateUniqueAmount(plan.basePrice);
    if (!uniqueAmount) {
      await ctx.reply('❌ امکان تولید مبلغ یکتا وجود ندارد. مجدداً تلاش کنید.');
      return;
    }

    await PaymentService.submitReceipt(user._id, plan._id, uniqueAmount, 'auto_photo_id');

    await ctx.replyWithMarkdown([
      '💰 *پرداخت کارت به کارت*', '',
      `💳 شماره کارت: \`${cardNumber}\``,
      `💰 مبلغ دقیق: ${formatRials(uniqueAmount)}`,
      '',
      '📋 مبلغ دقیق را واریز کنید. تأیید از طریق پیامک بانک انجام می‌شود.',
      '⚠️ در صورت عدم تأیید خودکار، رسید را آپلود کنید:',
    ].join('\n'), Markup.inlineKeyboard([
      [Markup.button.callback('📎 آپلود رسید', `cardpay_${plan._id}`)],
      [Markup.button.callback('🔙 بازگشت',    'buy_renew')],
    ]));
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

// ─── Free trial ───────────────────────────────────────────────────────────────

export async function handleFreeTrial(ctx) {
  try {
    const user      = ctx.user || await UserService.resolveUser(ctx.from.id);
    const trialPlan = await PlanService.getTrialPlan();

    if (!trialPlan) {
      await safeEdit(ctx, '❌ در حال حاضر طرح آزمایشی در دسترس نیست.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const usedTrial = await Subscription.findOne({ ownerId: user._id, planId: trialPlan._id });
    if (usedTrial) {
      await ctx.replyWithMarkdown(
        '🎁 *طرح آزمایشی*\n\nشما قبلاً از طرح آزمایشی استفاده کرده‌اید.\nبرای خرید از گزینه "خرید اشتراک" استفاده کنید.',
        mainMenuKeyboard,
      );
      return;
    }

    await SubscriptionService.forceCreateSubscription(user.telegramId, trialPlan._id);

    await ctx.replyWithMarkdown([
      '✅ *طرح آزمایشی فعال شد*', '',
      `طرح "${trialPlan.title}" آماده است.`,
      `📅 مدت: ${trialPlan.durationDays} روز`,
      `💾 حجم: ${trialPlan.baseVolumeGB} GB`,
      '',
      '⏳ تایمر اشتراک پس از اولین اتصال شروع می‌شود.',
      '🔹 HORNET',
    ].join('\n'), mainMenuKeyboard);
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}
