import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';
import { formatRials, formatBytes, formatRank, calculateRank } from '../utils.js';
import {
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

/** Sends the persistent main-menu reply keyboard, including any admin-defined custom buttons. */
async function sendMainMenu(ctx, title) {
  const lang = ctx.lang || 'fa';
  const { customButtonRows } = await import('../customButtons.js');
  const customRows = await customButtonRows(lang);
  await ctx.reply(title || t('main_menu_title', lang), {
    reply_markup: mainReplyKeyboard(lang, customRows).reply_markup,
  });
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

    // Single, persistent bottom keyboard is the whole main menu.
    await sendMainMenu(ctx, `${t('welcome_title', lang)}\n\n${t('welcome_choose_option', lang)}`);
  } catch (err) {
    logger.error({ err }, '[bot] startCommand error');
    await ctx.reply(t('error_generic_request', ctx.lang));
  }
}

export async function handleMainMenu(ctx) {
  // Reply-keyboard is the main menu; just (re)show it. If we arrived here from
  // an inline button, answer the callback so the spinner stops.
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  await sendMainMenu(ctx);
}

/**
 * User-facing /restart: bail out of any stuck scene/flow and return to the
 * main menu. (Admin process-restart is a separate command in index.js.)
 */
export async function handleRestart(ctx) {
  try { if (ctx.scene?.current) await ctx.scene.leave(); } catch { /* ignore */ }
  if (ctx.session) ctx.session.__scenes = {};
  return handleMainMenu(ctx);
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

// status → i18n key for a localized, friendly status label
const SUB_STATUS_KEYS = {
  active: 'sub_status_active',
  on_hold: 'sub_status_on_hold',
  expired: 'sub_status_expired',
  suspended: 'sub_status_suspended',
  trial: 'sub_status_trial',
  cancelled: 'sub_status_cancelled',
  pending_payment: 'sub_status_pending_payment',
  pending_shared_payment: 'sub_status_pending_payment',
};

function subStatusLabel(status, lang) {
  return t(SUB_STATUS_KEYS[status] || 'sub_status_unknown', lang);
}

export async function handleMySubscriptions(ctx) {
  const lang = ctx.lang || 'fa';
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  const User = (await import('../../models/User.js')).default;
  const Subscription = (await import('../../models/Subscription.js')).default;
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  const subs = await Subscription.find({ ownerId: user._id })
    .populate('planId', 'title')
    .sort({ createdAt: -1 })
    .lean();

  if (!subs.length) {
    await smartReply(ctx, t('no_active_subscriptions', lang), {
      reply_markup: { inline_keyboard: [[{ text: t('btn_buy_renew', lang), callback_data: 'buy_renew' }]] },
    });
    return;
  }

  const rows = subs.map((s) => [{
    text: `${s.planId?.title || t('sub_plan_unknown', lang)} — ${subStatusLabel(s.status, lang)}`,
    callback_data: `sub_detail_${s._id}`,
  }]);

  await smartReply(ctx, t('subscriptions_list_title', lang), {
    reply_markup: { inline_keyboard: rows },
  });
}

/**
 * Builds the rich detail text for one subscription: plan, status, remaining
 * days, volume (used / total / remaining, or "unlimited"), and the sub link.
 */
async function buildSubscriptionDetail(sub, lang) {
  const TunnelConfig = (await import('../../models/TunnelConfig.js')).default;
  const now = Date.now();
  const remainingDays = sub.expireDate
    ? Math.max(0, Math.ceil((new Date(sub.expireDate).getTime() - now) / 86400000))
    : 0;

  // Convention: totalVolumeBytes <= 0 means an unlimited plan.
  const unlimited = !sub.totalVolumeBytes || sub.totalVolumeBytes <= 0;
  const volumeLine = unlimited
    ? t('sub_volume_unlimited', lang)
    : t('sub_volume_value', lang, {
        used: formatBytes(sub.usedVolumeBytes || 0, lang),
        total: formatBytes(sub.totalVolumeBytes, lang),
        remaining: formatBytes(Math.max(0, sub.totalVolumeBytes - (sub.usedVolumeBytes || 0)), lang),
      });

  const tunnel = await TunnelConfig.findOne({ subscriptionId: sub._id, isActive: true })
    .sort({ createdAt: -1 }).lean();
  const link = tunnel ? `${config.backendUrl}/sub/${tunnel.uuid}` : t('sub_no_config_yet', lang);

  return [
    t('subscription_detail_title', lang),
    '',
    t('sub_field_plan', lang, { plan: sub.planId?.title || t('sub_plan_unknown', lang) }),
    t('sub_field_status', lang, { status: subStatusLabel(sub.status, lang) }),
    t('sub_field_remaining_days', lang, { days: remainingDays }),
    t('sub_field_volume', lang, { volume: volumeLine }),
    '',
    t('sub_field_link', lang, { link }),
  ].join('\n');
}

export async function handleSubscriptionDetail(ctx) {
  const lang = ctx.lang || 'fa';
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  const subId = ctx.match[1];
  try {
    const Subscription = (await import('../../models/Subscription.js')).default;
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const sub = await Subscription.findOne({ _id: subId, ownerId: user._id }).populate('planId', 'title');
    if (!sub) {
      await ctx.reply(t('error_not_found', lang, { resource: 'Subscription' }));
      return;
    }

    const text = await buildSubscriptionDetail(sub, lang);
    const rows = [];
    if (sub.status === 'active') {
      rows.push([{ text: t('btn_get_config', lang), callback_data: `config_pick_${sub._id}` }]);
      rows.push([{ text: t('btn_change_config', lang), callback_data: `sub_rotate_${sub._id}` }]);
    } else if (sub.status === 'expired') {
      rows.push([{ text: t('btn_renew_subscription', lang), callback_data: 'buy_renew' }]);
    }
    rows.push([{ text: t('btn_back', lang), callback_data: 'my_subscriptions' }]);

    await smartReply(ctx, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: rows },
    });
  } catch (err) {
    logger.error({ err, subId }, '[bot] handleSubscriptionDetail error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

/** Shows the client picker for a specific subscription (from the detail view). */
export async function handleConfigPick(ctx) {
  const lang = ctx.lang || 'fa';
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  const subId = ctx.match[1];
  await ctx.reply(t('config_pick_client', lang), {
    reply_markup: generateClientPickerKeyboard(lang, subId).reply_markup,
  });
}

/**
 * Rotates (changes) the config: deactivates the current tunnel(s), provisions a
 * fresh UUID, and queues remove/create commands to the node-agent. Returns the
 * new subscription link to the user.
 */
export async function handleSubRotateConfig(ctx) {
  const lang = ctx.lang || 'fa';
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  const subId = ctx.match[1];
  try {
    const Subscription = (await import('../../models/Subscription.js')).default;
    const TunnelConfig = (await import('../../models/TunnelConfig.js')).default;
    const User = (await import('../../models/User.js')).default;
    const NodeCommandService = (await import('../../services/infra/NodeCommandService.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const sub = await Subscription.findOne({ _id: subId, ownerId: user._id, status: 'active' }).populate('planId');
    if (!sub) {
      await ctx.reply(t('create_sublink_no_active_subscription', lang));
      return;
    }

    // Deactivate existing configs and ask the node to remove their users.
    const oldConfigs = await TunnelConfig.find({ subscriptionId: sub._id, isActive: true });
    for (const old of oldConfigs) {
      old.isActive = false;
      await old.save();
      if (sub.serverId) {
        await NodeCommandService.executeNodeCommand(sub.serverId, 'remove_user', {
          email: `user-${old.uuid}@hornet.node`,
        });
      }
    }

    // Provision a fresh tunnel + create_user command.
    const { tunnelConfig } = await ProvisioningService.provisionTunnelOnNode(sub, sub.planId, user);
    const subLink = `${config.backendUrl}/sub/${tunnelConfig.uuid}`;

    await ctx.reply(t('config_rotated', lang, { link: subLink }), {
      reply_markup: generateClientPickerKeyboard(lang, sub._id).reply_markup,
    });
  } catch (err) {
    logger.error({ err, subId }, '[bot] handleSubRotateConfig error');
    await ctx.reply(t('error_generic_request', lang));
  }
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

/** Comprehensive bot usage guide (/help). */
export async function handleHelp(ctx) {
  const lang = ctx.lang || 'fa';
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  await ctx.reply(t('help_message', lang), { parse_mode: 'Markdown' });
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

/**
 * Auto card-to-card ("I paid"): shows the card + an exact, per-order unique
 * amount and creates a photo-less pending Receipt (method:'auto'). The user
 * pays, then taps "I paid"; when the bank SMS for that unique amount is
 * forwarded to the webhook, processSmsWebhook auto-approves and provisions —
 * no receipt photo, no admin step.
 */
export async function handleAutoCardPayment(ctx) {
  const lang = ctx.lang || 'fa';
  const planId = ctx.match[1];
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  try {
    const plan = await PlanRepository.findById(planId);
    if (!plan) {
      await ctx.reply(t('error_not_found', lang, { resource: 'Plan' }));
      return;
    }

    const User = (await import('../../models/User.js')).default;
    const Receipt = (await import('../../models/Receipt.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });

    const uniqueAmount = await PaymentService.generateUniqueAmount(plan.basePrice);
    const cardNumber = await SettingRepository.get('payment.cardNumber', config.cardNumber);

    const receipt = await Receipt.create({
      userId: user._id,
      planId,
      amount: uniqueAmount,
      method: 'auto',
      status: 'pending',
      gateway: 'card_auto',
    });

    await ctx.reply(t('card_payment_instructions', lang, {
      cardNumber,
      amount: formatRials(uniqueAmount, lang),
    }), {
      reply_markup: {
        inline_keyboard: [
          [{ text: t('btn_i_paid', lang), callback_data: `ipaid_${receipt._id}` }],
          [{ text: t('btn_upload_receipt_manual', lang), callback_data: `cardpay_${planId}` }],
          [{ text: t('btn_cancel', lang), callback_data: 'main_menu' }],
        ],
      },
    });
  } catch (err) {
    logger.error({ err, planId }, '[bot] handleAutoCardPayment error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

/**
 * The user confirms they transferred the money. We just acknowledge — actual
 * confirmation happens automatically when the matching bank SMS arrives.
 */
export async function handleIPaid(ctx) {
  const lang = ctx.lang || 'fa';
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  await smartReply(ctx, t('i_paid_ack', lang));
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
