import UserService from '../../services/UserService.js';
import PlanService from '../../services/PlanService.js';
import SubscriptionService from '../../services/SubscriptionService.js';
import PaymentService from '../../services/PaymentService.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import SettingRepository from '../../repositories/SettingRepository.js';
import Subscription from '../../models/Subscription.js';
import { Markup } from 'telegraf';
import { formatRials, formatBytes, formatDate, formatError } from '../utils.js';
import { mainMenuKeyboard, subscriptionActionsKeyboard } from '../keyboards.js';

async function safeEdit(ctx, text, extra) {
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

async function getSubscriptionSummary(sub, plan, server) {
  const remaining = sub.remainingVolumeBytes;
  const usagePercent = sub.totalVolumeBytes > 0
    ? ((sub.usedVolumeBytes / sub.totalVolumeBytes) * 100).toFixed(1)
    : '0.0';
  const statusEmoji = sub.status === 'active' ? '✅' : sub.status === 'expired' ? '⚠️' : '🚫';
  const planTitle = plan?.title || 'طرح';
  const serverName = server?.name || '—';

  return [
    `${statusEmoji} *${planTitle}*`,
    `📊 وضعیت: ${sub.status === 'active' ? 'فعال' : sub.status === 'expired' ? 'منقضی شده' : 'مسدود'}`,
    `💾 مصرف: ${formatBytes(sub.usedVolumeBytes)} از ${formatBytes(sub.totalVolumeBytes)} (${usagePercent}%)`,
    `📋 باقی‌مانده: ${formatBytes(remaining)}`,
    `📅 شروع: ${formatDate(sub.startDate)}`,
    `📅 انقضا: ${formatDate(sub.expireDate)}`,
    `🖥 سرور: ${serverName}`,
  ].filter(Boolean).join('\n');
}

async function startCommand(ctx) {
  try {
    const referralCode = ctx.payload?.trim().toUpperCase() || null;
    ctx.user = await UserService.resolveUser(ctx.from.id, referralCode);

    const isMember = await checkChannelMembership(ctx);
    if (!isMember) {
      const channelId = process.env.CHANNEL_ID;
      await ctx.replyWithMarkdown(
        '🚫 *خوش آمدید*\n\n' +
        'برای استفاده از خدمات HORNET، لطفاً ابتدا در کانال ما عضو شوید:\n\n' +
        (channelId ? `👉 [عضویت در کانال](https://t.me/${channelId.replace('@', '')})` : ''),
      );
      return;
    }

    const user = ctx.user;
    const welcomeLines = [
      '🔹 *HORNET*',
      '',
      `خوش آمدید ${user.telegramId} عزیز`,
      `📊 سطح: ${user.rank || 'کاربر'}`,
      `💰 اعتبار: ${formatRials(user.walletBalance)}`,
      '',
      'لطفاً یکی از گزینه‌های زیر را انتخاب کنید:',
    ];

    await ctx.replyWithMarkdown(welcomeLines.join('\n'), mainMenuKeyboard);
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function showMainMenu(ctx, prefix) {
  const text = prefix
    ? `${prefix}\n\n🔹 *HORNET*\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:`
    : '🔹 *HORNET*\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:';

  if (ctx.callbackQuery?.message) {
    try {
      await safeEdit(ctx, text, { parse_mode: 'Markdown', ...mainMenuKeyboard });
      await ctx.answerCbQuery();
    } catch {
      await ctx.replyWithMarkdown(text, mainMenuKeyboard);
    }
  } else {
    await ctx.replyWithMarkdown(text, mainMenuKeyboard);
  }
}

async function handleMainMenu(ctx) {
  await showMainMenu(ctx);
}

async function handleProfile(ctx) {
  try {
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const activeCount = await SubscriptionRepository.countByOwnerAndStatus(user._id, 'active');
    const totalSpent = user.totalSpent || 0;

    const lines = [
      '📊 *وضعیت حساب کاربری*',
      '',
      `🆔 شناسه: \`${user.telegramId}\``,
      `📊 سطح: ${user.rank || 'کاربر'}`,
      `💰 اعتبار: ${formatRials(user.walletBalance)}`,
      `💸 مجموع هزینه: ${formatRials(totalSpent)}`,
      `📡 اشتراک فعال: ${activeCount}`,
      `🔗 کد معرف: \`${user.referralCode || '—'}\``,
      '',
      '🔹 HORNET',
    ];

    if (ctx.callbackQuery?.message) {
      await safeEdit(ctx, lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
    } else {
      await ctx.replyWithMarkdown(lines.join('\n'), mainMenuKeyboard);
    }
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handleBuyRenew(ctx) {
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
      ...categories.map(cat => [
        Markup.button.callback(cat, `category_${cat}`),
      ]),
      [Markup.button.callback('🔙 بازگشت', 'main_menu')],
    ]);

    const lines = [
      '⚡ *خرید اشتراک*',
      '',
      'لطفاً دسته‌بندی طرح مورد نظر خود را انتخاب کنید:',
    ];

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...keyboard,
    });
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handleCategorySelection(ctx) {
  try {
    const category = ctx.match[1];
    const plans = await PlanService.getPlansByCategory(category);

    if (!plans || plans.length === 0) {
      await safeEdit(ctx, `❌ هیچ طرحی در دسته "${category}" یافت نشد.`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 بازگشت به دسته‌بندی', 'buy_renew')],
        ]).reply_markup,
      });
      return;
    }

    const keyboardRows = plans.map(plan => [
      Markup.button.callback(
        `${plan.title} - ${formatRials(plan.basePrice)}`,
        `select_plan_${plan._id}`,
      ),
    ]);

    keyboardRows.push([Markup.button.callback('🔙 بازگشت', 'buy_renew')]);

    const lines = [
      `📁 *دسته: ${category}*`,
      '',
      'طرح مورد نظر خود را انتخاب کنید:',
    ];

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(keyboardRows).reply_markup,
    });
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handleMySubscriptions(ctx) {
  try {
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const subs = await SubscriptionRepository.findByOwner(user._id);

    if (!subs || subs.length === 0) {
      const lines = [
        '📋 *اشتراک‌های من*',
        '',
        'شما هیچ اشتراک فعالی ندارید.',
        'از گزینه "خرید اشتراک" یک طرح انتخاب کنید.',
      ];
      await safeEdit(ctx, lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const lines = ['📋 *اشتراک‌های من*', ''];
    const populatedSubs = await Subscription.find({
      _id: { $in: subs.map(s => s._id) },
    }).populate('planId').populate('serverId');

    for (const sub of populatedSubs) {
      lines.push('─'.repeat(15));
      lines.push(await getSubscriptionSummary(sub, sub.planId, sub.serverId));
    }

    lines.push('');
    lines.push('🔹 HORNET');

    if (ctx.callbackQuery?.message) {
      await safeEdit(ctx, lines.join('\n'), {
        parse_mode: 'Markdown',
        ...subscriptionActionsKeyboard(),
      });
    } else {
      await ctx.replyWithMarkdown(lines.join('\n'), subscriptionActionsKeyboard());
    }
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handleCreateSubLink(ctx) {
  try {
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const sub = await SubscriptionRepository.findActiveByOwner(user._id);

    if (!sub) {
      await ctx.reply('❌ اشتراک فعالی ندارید. لطفاً ابتدا یک طرح خریداری کنید.');
      return;
    }

    return ctx.scene.enter('create-sublink');
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handlePlanSelection(ctx) {
  try {
    const planId = ctx.match[1];
    const plan = await PlanService.getPlanById(planId);

    if (!plan) {
      await safeEdit(ctx, '❌ طرح مورد نظر یافت نشد.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const vol = plan.baseVolumeGB > 0 ? `${plan.baseVolumeGB} GB` : '♾ نامحدود';
    const dur = plan.durationDays >= 30 ? `${Math.floor(plan.durationDays / 30)} ماه` : `${plan.durationDays} روز`;

    const lines = [
      `📦 *${plan.title}*`,
      '',
      `📁 دسته: ${plan.category}`,
      `💾 حجم: ${vol}`,
      `📅 مدت: ${dur}`,
      `🔗 حداکثر لینک: ${plan.maxSubLinks}`,
      `💰 قیمت: ${formatRials(plan.basePrice)}`,
      '',
      'آیا مایل به ادامه هستید؟',
    ];

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('✅ ادامه به پرداخت', `checkout_${plan._id}`)],
      [Markup.button.callback('🔙 بازگشت', 'buy_renew')],
    ]);

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      ...kb,
    });
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handleCardPayment(ctx) {
  try {
    const planId = ctx.match[1];
    const plan = await PlanService.getPlanById(planId);

    if (!plan) {
      await ctx.reply('❌ طرح مورد نظر یافت نشد.');
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.pendingPayment = { planId: plan._id.toString(), amount: plan.basePrice };

    return ctx.scene.enter('receipt-upload');
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handleAutoCardPayment(ctx) {
  try {
    const planId = ctx.match[1];
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const plan = await PlanService.getPlanById(planId);

    if (!plan) {
      await ctx.reply('❌ طرح مورد نظر یافت نشد.');
      return;
    }

    const cardNumber = await SettingRepository.get('cardNumber', '5022-2910-XXXX-XXXX');
    const uniqueAmount = await PaymentService.generateUniqueAmount(plan.basePrice);
    if (!uniqueAmount) {
      await ctx.reply('❌ امکان تولید مبلغ یکتا وجود ندارد. لطفاً مجدداً تلاش کنید.');
      return;
    }

    await PaymentService.submitReceipt(user._id, plan._id, uniqueAmount, 'auto_photo_id');

    const lines = [
      '💰 *پرداخت کارت به کارت*',
      '',
      `💳 شماره کارت: \`${cardNumber}\``,
      `💰 مبلغ دقیق: ${formatRials(uniqueAmount)}`,
      '',
      '📋 مبلغ دقیق را به شماره کارت واریز کنید.',
      'رسید به صورت خودکار از طریق پیامک بانک تأیید می‌شود.',
      '',
      '⚠️ در صورت عدم تأیید خودکار، رسید را به صورت دستی آپلود کنید:',
    ];

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('📎 آپلود رسید', `cardpay_${plan._id}`)],
      [Markup.button.callback('🔙 بازگشت', 'buy_renew')],
    ]);

    await ctx.replyWithMarkdown(lines.join('\n'), kb);
    await ctx.replyWithMarkdown('🔹 *HORNET*', mainMenuKeyboard);
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handleCheckout(ctx) {
  try {
    const planId = ctx.match[1];
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const plan = await PlanService.getPlanById(planId);

    if (!plan) {
      await safeEdit(ctx, '❌ طرح مورد نظر یافت نشد.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const balance = user.walletBalance;
    const price = plan.basePrice;
    const lines = [
      '🧾 *تسویه حساب*',
      '',
      `📦 طرح: ${plan.title}`,
      `💰 مبلغ: ${formatRials(price)}`,
      `💳 اعتبار: ${formatRials(balance)}`,
      '',
    ];
    const backBtn = [Markup.button.callback('🔙 بازگشت', 'buy_renew')];

    if (balance >= price) {
      lines.push('✅ موجودی کافی است.');
      lines.push('آیا از کیف پول پرداخت می‌کنید؟');
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('💳 پرداخت از اعتبار', `checkout_confirm_${plan._id}`)],
        [Markup.button.callback('🏦 کارت به کارت', `cardpay_${plan._id}`)],
        [Markup.button.callback('🔙 لغو', 'buy_renew')],
      ]);
      await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...kb });
    } else {
      lines.push('❌ اعتبار کافی ندارید.');
      lines.push(`💰 ${formatRials(price - balance)} کسر اعتبار دارید.`);
      lines.push('لطفاً از طریق کارت به کارت پرداخت کنید:');
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🏦 کارت به کارت', `cardpay_${plan._id}`)],
        backBtn,
      ]);
      await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...kb });
    }
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

async function handleCheckoutConfirm(ctx) {
  try {
    const planId = ctx.match[1];
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const plan = await PlanService.getPlanById(planId);

    if (!plan) {
      await safeEdit(ctx, '❌ طرح مورد نظر یافت نشد.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    await SubscriptionService.createSubscription(user._id, plan._id);

    const vol = plan.baseVolumeGB > 0 ? `${plan.baseVolumeGB} GB` : '♾ نامحدود';
    const dur = plan.durationDays >= 30 ? `${Math.floor(plan.durationDays / 30)} ماه` : `${plan.durationDays} روز`;

    const lines = [
      '✅ *پرداخت با موفقیت انجام شد*',
      '',
      `📦 طرح: ${plan.title}`,
      `💾 حجم: ${vol}`,
      `📅 مدت: ${dur}`,
      `💰 مبلغ: ${formatRials(plan.basePrice)}`,
      '',
      'اشتراک شما فعال شد. 🔹 HORNET',
    ];

    await safeEdit(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard.reply_markup,
    });
    await ctx.answerCbQuery();
  } catch (error) {
    if (error?.name === 'InsufficientBalanceError' || error?.constructor?.name === 'InsufficientBalanceError') {
      await safeEdit(ctx, '❌ اعتبار کافی ندارید.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }
    await safeEdit(ctx, `❌ خطا در پرداخت: ${error.message}`, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard.reply_markup,
    });
  }
}

async function handleFreeTrial(ctx) {
  try {
    const user = ctx.user || await UserService.resolveUser(ctx.from.id);
    const trialPlan = await PlanService.getTrialPlan();

    if (!trialPlan) {
      await safeEdit(ctx, '❌ در حال حاضر طرح آزمایشی در دسترس نیست.', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup,
      });
      return;
    }

    const usedTrial = await Subscription.findOne({
      ownerId: user._id,
      planId: trialPlan._id,
    });

    if (usedTrial) {
      await ctx.replyWithMarkdown(
        '🎁 *طرح آزمایشی*\n\n' +
        'شما قبلاً از طرح آزمایشی استفاده کرده‌اید.\n' +
        'هر کاربر تنها یک بار می‌تواند از این طرح استفاده کند.\n\n' +
        'برای خرید اشتراک از گزینه "خرید اشتراک" استفاده کنید.',
        mainMenuKeyboard,
      );
      return;
    }

    await SubscriptionService.forceCreateSubscription(user.telegramId, trialPlan._id);

    await ctx.replyWithMarkdown(
      '✅ *طرح آزمایشی فعال شد*\n\n' +
      `طرح "${trialPlan.title}" با موفقیت فعال شد.\n` +
      `📅 مدت: ${trialPlan.durationDays} روز\n` +
      `💾 حجم: ${trialPlan.baseVolumeGB} GB\n\n` +
      '🔹 HORNET',
      mainMenuKeyboard,
    );
  } catch (error) {
    await ctx.reply(formatError(error));
  }
}

export {
  safeEdit,
  checkChannelMembership,
  getSubscriptionSummary,
  startCommand,
  showMainMenu,
  handleMainMenu,
  handleProfile,
  handleBuyRenew,
  handleCategorySelection,
  handleMySubscriptions,
  handleCreateSubLink,
  handlePlanSelection,
  handleCardPayment,
  handleAutoCardPayment,
  handleCheckout,
  handleCheckoutConfirm,
  // handleMockRecharge removed for security
  handleFreeTrial,
};
