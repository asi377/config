import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';
import { formatRials, formatRank, calculateRank } from '../utils.js';
import {
  mainMenuKeyboard,
  generatePlansKeyboard,
} from '../keyboards.js';
import PlanRepository from '../../repositories/PlanRepository.js';
import PaymentService from '../../services/PaymentService.js';
import SettingRepository from '../../repositories/SettingRepository.js';
import config from '../../config/index.js';

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

    await ctx.msgQueue.sendMessage(
      ctx.chat.id,
      `${t('welcome_title', lang)}\n\n${t('welcome_choose_option', lang)}`,
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
  await ctx.editMessageText(t('main_menu_title', lang), {
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

    await ctx.editMessageText(message, {
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

  await ctx.editMessageText(t('select_plan_title', lang), {
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

  await ctx.editMessageText(text, {
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
  await ctx.reply(t('get_config_message', lang));
}

export async function handleFreeTrial(ctx) {
  const lang = ctx.lang || 'fa';
  await ctx.reply(t('free_trial_message', lang));
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
  await ctx.reply(t('order_confirmed', lang));
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

export async function handleConfigClientPick(ctx) {
  const lang = ctx.lang || 'fa';
  const client = ctx.match[1];
  await ctx.reply(t('config_for_client', lang, { client }));
}
