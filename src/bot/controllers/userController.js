import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';
import { formatRials, formatRank, calculateRank } from '../utils.js';
import {
  mainMenuKeyboard,
  generatePlansKeyboard,
  generateClientPickerKeyboard,
  generateExtraDataKeyboard,
  walletMenuKeyboard,
  mainReplyKeyboard,
} from '../keyboards.js';
import PlanRepository from '../../repositories/PlanRepository.js';
import PaymentService from '../../services/PaymentService.js';
import SettingRepository from '../../repositories/SettingRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import subscriptionService from '../../services/SubscriptionService.js';
import ProvisioningService from '../../services/ProvisioningService.js';
import TunnelService from '../../services/TunnelService.js';
import AddonService from '../../services/AddonService.js';
import config from '../../config/index.js';

/**
 * Sends via ctx.editMessageText when triggered from an inline-button press
 * (a callback query exists, so there's a message to edit), falls back to a
 * plain ctx.reply when triggered from the persistent reply-keyboard (plain
 * text message — there is nothing to edit).
 */
async function smartReply(ctx, text, extra) {
  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, extra);
    } catch (err) {
      return ctx.reply(text, extra);
    }
  }
  return ctx.reply(text, extra);
}

export async function startCommand(ctx) {
  try {
    const User = (await import('../../models/User.js')).default;
    const telegramId = String(ctx.from.id);
    let user = await User.findOne({ telegramId });

    if (!user) {
      user = await User.create({
        telegramId,
        role: 'user',
      });
      logger.info({ telegramId }, '[bot] New user registered');
    }

    const lang = ctx.lang || user.language || 'fa';

    await ctx.reply(t('welcome_title', lang), {
      reply_markup: mainReplyKeyboard(lang).reply_markup,
    });

    await ctx.msgQueue.sendMessage(
      ctx.chat.id,
      t('welcome_choose_option', lang),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: t('btn_buy_subscription', lang), callback_data: 'buy_renew' }],
            [{ text: t('btn_my_account', lang), callback_data: 'profile' }],
            [{ text: t('btn_help', lang), callback_data: 'help' }],
            [{ text: '🌐 Change Language', callback_data: 'change_language' }],
          ],
        },
      },
    );
  } catch (err) {
    logger.error({ err }, '[bot] startCommand error');
    await ctx.reply(t('error_generic_request', ctx.lang));
  }
}

export async function handleMainMenu(ctx) {
  const lang = ctx.lang || 'fa';
  await smartReply(ctx, t('main_menu_title', lang), {
    reply_markup: mainMenuKeyboard(lang, ctx.user).reply_markup,
  });
}

export async function handleProfile(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const rank = calculateRank(user?.totalSpent || 0);
    const message = [
      t('profile_title', lang),
      '',
      t('profile_telegram_id', lang, { telegramId: user?.telegramId }),
      t('profile_balance', lang, { balance: formatRials(user?.walletBalance || 0, lang) }),
      t('profile_referral_code', lang, { code: user?.referralCode || t('profile_referral_code_na', lang) }),
      t('profile_rank', lang, { rank: formatRank(rank, lang) }),
    ].join('\n');

    await smartReply(ctx, message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: t('btn_back', lang), callback_data: 'main_menu' }],
        ],
      },
    });
  } catch (err) {
    logger.error({ err }, '[bot] handleProfile error');
  }
}

export async function handleBuyRenew(ctx) {
  const lang = ctx.lang || 'fa';
  const Plan = (await import('../../models/Plan.js')).default;
  const plans = await Plan.find({ isActive: true, salesEnabled: true }).lean();

  const keyboard = generatePlansKeyboard(lang, plans, formatRials);

  await smartReply(ctx, t('select_plan_title', lang), {
    reply_markup: keyboard.reply_markup,
  });
}

export async function handleMySubscriptions(ctx) {
  const lang = ctx.lang || 'fa';
  const Subscription = (await import('../../models/Subscription.js')).default;
  const subs = await Subscription.find({
    ownerId: (await (await import('../../models/User.js')).default.findOne({ telegramId: String(ctx.from.id) }))._id,
  });
  const text = subs.length > 0
    ? `${t('subscriptions_title', lang)}\n${subs.map((s) => t('subscriptions_status_line', lang, { status: s.status })).join('\n')}`
    : t('no_active_subscriptions', lang);

  await smartReply(ctx, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: t('btn_back', lang), callback_data: 'main_menu' }],
      ],
    },
  });
}

export async function handleCreateSubLink(ctx) {
  await ctx.scene.enter('createSubLinkScene');
}

export async function handleGetConfig(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    const User = (await import('../../models/User.js')).default;
    const TunnelConfig = (await import('../../models/TunnelConfig.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const sub = await SubscriptionRepository.findActiveByOwner(user._id);

    if (!sub) {
      await ctx.reply(t('create_sublink_no_active_subscription', lang));
      return;
    }

    let tunnel = await TunnelConfig.findOne({ subscriptionId: sub._id, isActive: true }).sort({ createdAt: -1 });
    if (!tunnel) {
      tunnel = await TunnelService.createSubLink(sub._id, 'default');
    }

    const subLink = `${config.backendUrl}/sub/${tunnel.uuid}`;
    await ctx.reply(t('get_config_ready', lang, { link: subLink }), {
      reply_markup: generateClientPickerKeyboard(lang, sub._id).reply_markup,
    });
  } catch (err) {
    logger.error({ err }, '[bot] handleGetConfig error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

export async function handleFreeTrial(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) {
      await ctx.reply(t('error_generic_request', lang));
      return;
    }

    if (user.freeTrialClaimedAt) {
      await ctx.reply(t('free_trial_already_claimed', lang));
      return;
    }

    const trialPlan = await PlanRepository.findTrialPlan();
    if (!trialPlan) {
      await ctx.reply(t('free_trial_unavailable', lang));
      return;
    }

    const subscription = await subscriptionService.createSubscription(user._id, trialPlan._id);
    const activated = await subscriptionService.activateSubscription(subscription._id);
    const { tunnelConfig } = await ProvisioningService.provisionTunnelOnNode(activated, trialPlan, user);

    user.freeTrialClaimedAt = new Date();
    await user.save();

    const subLink = `${config.backendUrl}/sub/${tunnelConfig.uuid}`;
    await ctx.reply(t('free_trial_activated', lang, {
      days: trialPlan.durationDays,
      volume: trialPlan.baseVolumeGB,
      link: subLink,
    }));
  } catch (err) {
    logger.error({ err }, '[bot] handleFreeTrial error');
    await ctx.reply(t('free_trial_failed', lang));
  }
}

export async function handleUpdateUuid(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const sub = await SubscriptionRepository.findOne({ ownerId: user._id }, { sort: { createdAt: -1 } });

    if (sub?.status === 'active') {
      await handleGetConfig(ctx);
      return;
    }

    await ctx.reply(t('panel_on_hold_message', lang));
  } catch (err) {
    logger.error({ err }, '[bot] handleUpdateUuid error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

export async function handleContactSupport(ctx) {
  const lang = ctx.lang || 'fa';
  const contact = await SettingRepository.get('support.contact', '@hornet_support');
  await ctx.reply(t('contact_support_message', lang, { contact }));
}

export async function handleConnectionGuide(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('connection_guide_message', lang), { parse_mode: 'Markdown' });
}

export async function handleFaq(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('faq_message', lang));
}

export async function handlePricingList(ctx) {
  const lang = ctx.lang || 'fa';
  const Plan = (await import('../../models/Plan.js')).default;
  const plans = await Plan.find({ isActive: true, salesEnabled: true }).sort({ sortOrder: 1 }).lean();

  if (!plans.length) {
    await ctx.reply(t('no_plans_available', lang));
    return;
  }

  const lines = plans.map((p) => `• ${p.title} — ${p.baseVolumeGB}GB / ${p.durationDays}روز — ${formatRials(p.basePrice, lang)}`);
  await ctx.reply([t('pricing_title', lang), '', ...lines].join('\n'));
}

export async function handleWalletMenu(ctx) {
  const lang = ctx.lang || 'fa';
  const User = (await import('../../models/User.js')).default;
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  await ctx.reply(t('wallet_balance_message', lang, { balance: formatRials(user?.walletBalance || 0, lang) }), {
    reply_markup: walletMenuKeyboard(lang).reply_markup,
  });
}

export async function handleWalletTopupStart(ctx) {
  await ctx.scene.enter('walletTopupScene');
}

export async function handleExtraDataMenu(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const sub = await SubscriptionRepository.findActiveByOwner(user._id);

    if (!sub) {
      await ctx.reply(t('create_sublink_no_active_subscription', lang));
      return;
    }

    const options = [5, 10, 20];
    const quotes = await Promise.all(options.map((gb) => AddonService.quoteExtraDataPrice(sub._id, gb)));
    const items = options.map((gb, i) => ({ gb, price: quotes[i].total }));

    await ctx.reply(t('extra_data_menu_title', lang), {
      reply_markup: generateExtraDataKeyboard(lang, sub._id, items, formatRials).reply_markup,
    });
  } catch (err) {
    logger.error({ err }, '[bot] handleExtraDataMenu error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

export async function handleExtraDataConfirm(ctx) {
  const lang = ctx.lang || 'fa';
  const gb = parseInt(ctx.match[1], 10);
  const subscriptionId = ctx.match[2];

  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const { price } = await AddonService.purchaseExtraData(user._id, subscriptionId, gb);

    await ctx.editMessageText(t('extra_data_purchased', lang, { gb, price: formatRials(price, lang) }));
  } catch (err) {
    if (err.name === 'InsufficientBalanceError') {
      await ctx.reply(t('error_insufficient_balance', lang));
      return;
    }
    logger.error({ err }, '[bot] handleExtraDataConfirm error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

export async function handleCategorySelection(ctx) {
  const lang = ctx.lang || 'fa';
  const category = ctx.match[1];
  const plans = await PlanRepository.findMany({ isActive: true, salesEnabled: true, category });
  const keyboard = generatePlansKeyboard(lang, plans, formatRials);
  await ctx.editMessageText(t('select_plan_title', lang), {
    reply_markup: keyboard.reply_markup,
  });
}

export async function handlePlanSelection(ctx) {
  const lang = ctx.lang || 'fa';
  const planId = ctx.match[1];
  try {
    const plan = await PlanRepository.findById(planId);
    if (!plan) {
      await ctx.reply(t('error_not_found', lang, { resource: 'Plan' }));
      return;
    }

    ctx.session.selectedPlanId = planId;

    await ctx.reply(
      t('plan_selected_message', lang, {
        planTitle: plan.title,
        price: formatRials(plan.basePrice, lang),
      }),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: t('btn_confirm', lang), callback_data: `checkout_${planId}` }],
            [{ text: t('btn_cancel', lang), callback_data: 'main_menu' }],
          ],
        },
      },
    );
  } catch (err) {
    logger.error({ err, planId }, '[bot] handlePlanSelection error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

export async function handleCheckout(ctx) {
  const lang = ctx.lang || 'fa';
  const planId = ctx.match[1];
  await ctx.editMessageText(t('select_payment_method', lang), {
    reply_markup: {
      inline_keyboard: [
        [{ text: t('btn_card_to_card', lang), callback_data: `cardpay_${planId}` }],
        [{ text: t('btn_crypto', lang), callback_data: 'crypto_payment' }],
        [{ text: t('btn_wallet', lang), callback_data: `checkout_confirm_${planId}` }],
      ],
    },
  });
}

export async function handleCheckoutConfirm(ctx) {
  const lang = ctx.lang || 'fa';
  const planId = ctx.match[1];
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const plan = await PlanRepository.findById(planId);
    if (!plan) {
      await ctx.reply(t('error_not_found', lang, { resource: 'Plan' }));
      return;
    }

    const subscription = await subscriptionService.createSubscription(user._id, planId);
    const activated = await subscriptionService.activateSubscription(subscription._id);
    const { tunnelConfig } = await ProvisioningService.provisionTunnelOnNode(activated, plan, user);

    const subLink = `${config.backendUrl}/sub/${tunnelConfig.uuid}`;
    await ctx.reply(t('order_confirmed', lang));
    await ctx.reply(t('get_config_ready', lang, { link: subLink }), {
      reply_markup: generateClientPickerKeyboard(lang, activated._id).reply_markup,
    });
  } catch (err) {
    if (err.name === 'InsufficientBalanceError') {
      await ctx.reply(t('error_insufficient_balance', lang));
      return;
    }
    logger.error({ err, planId }, '[bot] handleCheckoutConfirm error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

export async function handleCardPayment(ctx) {
  const lang = ctx.lang || 'fa';
  const planId = ctx.match[1];
  try {
    const plan = await PlanRepository.findById(planId);
    if (!plan) {
      await ctx.reply(t('error_not_found', lang, { resource: 'Plan' }));
      return;
    }

    const uniqueAmount = await PaymentService.generateUniqueAmount(plan.basePrice);
    const cardNumber = await SettingRepository.get('payment.cardNumber', config.cardNumber);

    ctx.session.pendingPlanId = planId;
    ctx.session.pendingAmount = uniqueAmount;

    await ctx.reply(t('card_payment_instructions', lang, {
      cardNumber,
      amount: formatRials(uniqueAmount, lang),
    }));
    await ctx.reply(t('card_payment_exact_amount_notice', lang, {
      amount: formatRials(uniqueAmount, lang),
    }));
    await ctx.scene.enter('receiptUploadScene');
  } catch (err) {
    logger.error({ err, planId }, '[bot] handleCardPayment error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

export async function handleAutoCardPayment(ctx) {
  await handleCardPayment(ctx);
}

const CLIENT_INSTRUCTION_KEYS = {
  v2rayng: 'config_instructions_v2rayng',
  singbox: 'config_instructions_singbox',
  clash: 'config_instructions_clash',
  clashmeta: 'config_instructions_clashmeta',
};

export async function handleConfigClientPick(ctx) {
  const lang = ctx.lang || 'fa';
  const client = ctx.match[1];
  const subscriptionId = ctx.match[2];

  try {
    const TunnelConfig = (await import('../../models/TunnelConfig.js')).default;
    const tunnel = await TunnelConfig.findOne({ subscriptionId, isActive: true }).sort({ createdAt: -1 });
    if (!tunnel) {
      await ctx.reply(t('create_sublink_no_active_subscription', lang));
      return;
    }

    const subLink = `${config.backendUrl}/sub/${tunnel.uuid}`;
    const instructionsKey = CLIENT_INSTRUCTION_KEYS[client] || 'connection_guide_message';
    await ctx.reply(`${subLink}\n\n${t(instructionsKey, lang)}`, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error({ err, client, subscriptionId }, '[bot] handleConfigClientPick error');
    await ctx.reply(t('error_generic_request', lang));
  }
}
