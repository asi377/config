import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';
import { generateResellerMenuKeyboard, mainMenuKeyboard, generateReferralInlineKeyboard } from '../keyboards.js';
import ResellerPlanRepository from '../../repositories/ResellerPlanRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';

/**
 * Unified referral + reseller entry (option C): shows the user's referral data
 * (invite link, referral count, earnings) AND the reseller tiers/plans they can
 * apply to — all on one screen, with inline buttons only.
 */
export async function handleResellerMenu(ctx) {
  const lang = ctx.lang || 'fa';
  if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) { await ctx.reply(t('error_generic_request', lang)); return; }

    const referralCount = await User.countDocuments({ referredBy: user._id });
    const username = ctx.botInfo?.username;
    const link = username
      ? `https://t.me/${username}?start=${user.referralCode}`
      : user.referralCode;

    // Top section: referral data.
    const lines = [
      t('referral_panel_title', lang),
      '',
      t('referral_panel_link', lang, { link }),
      t('referral_panel_count', lang, { count: referralCount }),
      t('referral_panel_earnings', lang, { commission: user.referralCommission || 0 }),
    ];

    // Referral action buttons.
    const rows = [
      [{ text: t('btn_referral_invite_link', lang), callback_data: 'referral_invite_link' }],
      [
        { text: t('btn_referral_my_referrals', lang), callback_data: 'referral_my_referrals' },
        { text: t('btn_referral_earnings', lang), callback_data: 'referral_earnings' },
      ],
    ];

    // Bottom section: reseller plans to choose from (or current status).
    if (user.isReseller) {
      lines.push('', t('reseller_panel_active', lang));
      rows.push([{ text: t('btn_reseller_panel', lang), callback_data: 'reseller_panel' }]);
    } else if (user.resellerApplicationStatus === 'pending') {
      lines.push('', t('reseller_application_pending', lang));
    } else {
      const plans = await ResellerPlanRepository.findActive();
      if (plans.length) {
        lines.push('', t('reseller_menu_title', lang));
        for (const p of plans) {
          const cap = (p.maxActiveAccounts === null || p.maxActiveAccounts === undefined)
            ? t('reseller_cap_unlimited', lang)
            : String(p.maxActiveAccounts);
          rows.push([{
            text: t('reseller_tier_item', lang, {
              name: p.displayName, cap, discount: p.discountPercent, fee: p.applicationFee || 0,
            }),
            callback_data: `reseller_apply_${p._id}`,
          }]);
        }
      }
    }

    rows.push([{ text: t('btn_back_main_menu', lang), callback_data: 'main_menu' }]);

    const editFn = ctx.callbackQuery ? 'editMessageText' : 'reply';
    await ctx[editFn](lines.join('\n'), {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: rows },
    }).catch(() => ctx.reply(lines.join('\n'), {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: rows },
    }));
  } catch (err) {
    logger.error({ err }, '[bot] handleResellerMenu error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

/**
 * User picked a tier to apply to. `ctx.match[1]` is the ResellerPlan _id.
 *
 * - `requiresApproval === false` (the "open" tier): immediate approval, no
 *   fee path needed since it has applicationFee: 0 per seedDefaults.
 * - `requiresApproval === true`: charge applicationFee from wallet (if any),
 *   set status to pending, notify a superadmin.
 */
export async function handleResellerTierSelect(ctx) {
  const lang = ctx.lang || 'fa';
  const tierId = ctx.match[1];

  try {
    const User = (await import('../../models/User.js')).default;
    const tier = await ResellerPlanRepository.findById(tierId);
    if (!tier || !tier.isActive) {
      await ctx.answerCbQuery?.();
      await ctx.reply(t('reseller_tier_not_found', lang));
      return;
    }

    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) {
      await ctx.reply(t('error_generic_request', lang));
      return;
    }

    if (user.isReseller) {
      return handleResellerMiniPanel(ctx);
    }

    if (user.resellerApplicationStatus === 'pending') {
      await ctx.answerCbQuery?.();
      await ctx.reply(t('reseller_application_pending', lang));
      return;
    }

    if (tier.requiresApproval === false) {
      user.isReseller = true;
      user.currentResellerPlanId = tier._id;
      user.resellerApplicationStatus = 'approved';
      await user.save();

      await ctx.editMessageText(
        t('reseller_application_auto_approved', lang, { tier: tier.displayName }),
        { reply_markup: mainMenuKeyboard(lang, user).reply_markup },
      );
      return;
    }

    const fee = tier.applicationFee || 0;
    if (fee > 0) {
      if (user.walletBalance < fee) {
        await ctx.reply(t('reseller_insufficient_balance', lang, {
          balance: user.walletBalance,
          fee,
        }));
        return;
      }
      user.walletBalance -= fee;
    }

    user.currentResellerPlanId = tier._id;
    user.resellerApplicationStatus = 'pending';
    await user.save();

    await ctx.editMessageText(
      t('reseller_application_submitted', lang, { tier: tier.displayName }),
      { reply_markup: mainMenuKeyboard(lang, user).reply_markup },
    );

    // Notify a superadmin that an application needs review.
    try {
      const UserRepository = (await import('../../repositories/UserRepository.js')).default;
      const adminUser = await UserRepository.findOne({ role: 'superadmin' }, { sort: { createdAt: 1 } });
      if (adminUser?.telegramId) {
        await ctx.telegram.sendMessage(
          adminUser.telegramId,
          t('reseller_admin_notify_application', 'fa', {
            telegramId: user.telegramId,
            tier: tier.displayName,
            fee,
          }),
        );
      }
    } catch (notifyErr) {
      logger.error({ err: notifyErr }, '[bot] failed to notify superadmin of reseller application');
    }
  } catch (err) {
    logger.error({ err }, '[bot] handleResellerTierSelect error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

/**
 * Mini-panel for existing resellers: tier info, cap, accounts sold so far
 * (computed on demand via aggregation — no denormalized counter), referral
 * commission pool, and 5 most recent subscriptions sold to referred users.
 */
export async function handleResellerMiniPanel(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) }).populate('currentResellerPlanId');
    if (!user || !user.isReseller) {
      return handleResellerMenu(ctx);
    }

    const tier = user.currentResellerPlanId;
    const cap = tier && (tier.maxActiveAccounts === null || tier.maxActiveAccounts === undefined)
      ? t('reseller_cap_unlimited', lang)
      : String(tier?.maxActiveAccounts ?? '-');

    // Count distinct referred users with at least one active/on_hold subscription.
    const soldResult = await SubscriptionRepository.aggregate([
      { $match: { status: { $in: ['active', 'on_hold'] } } },
      { $lookup: { from: 'users', localField: 'ownerId', foreignField: '_id', as: 'owner' } },
      { $unwind: '$owner' },
      { $match: { 'owner.referredBy': user._id } },
      { $group: { _id: '$owner._id' } },
      { $count: 'soldCount' },
    ]);
    const soldCount = soldResult[0]?.soldCount || 0;

    const recentSubs = await SubscriptionRepository.aggregate([
      { $lookup: { from: 'users', localField: 'ownerId', foreignField: '_id', as: 'owner' } },
      { $unwind: '$owner' },
      { $match: { 'owner.referredBy': user._id } },
      { $sort: { createdAt: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' } },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      { $project: { createdAt: 1, planTitle: '$plan.title' } },
    ]);

    const recentLines = recentSubs.length
      ? recentSubs.map((s) => `• ${s.planTitle || '-'} — ${new Date(s.createdAt).toLocaleDateString()}`).join('\n')
      : t('reseller_no_recent_sales', lang);

    const message = [
      t('reseller_panel_title', lang),
      '',
      t('reseller_panel_tier', lang, { tier: tier?.displayName || '-' }),
      t('reseller_panel_discount', lang, { discount: tier?.discountPercent ?? 0 }),
      t('reseller_panel_cap', lang, { cap }),
      t('reseller_panel_sold', lang, { sold: soldCount }),
      t('reseller_panel_commission', lang, { commission: user.referralCommission || 0 }),
      '',
      t('reseller_panel_recent_header', lang),
      recentLines,
    ].join('\n');

    // Referral panel uses an INLINE keyboard (Invite Link / My Referrals /
    // Earnings) — never the persistent reply keyboard.
    const kb = generateReferralInlineKeyboard(lang).reply_markup;
    const editFn = ctx.editMessageText ? 'editMessageText' : 'reply';
    await ctx[editFn](message, { reply_markup: kb })
      .catch(() => ctx.reply(message, { reply_markup: kb }));
  } catch (err) {
    logger.error({ err }, '[bot] handleResellerMiniPanel error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

/**
 * Referral: show the user's personal invite link (Telegram deep link with their
 * referral code). Inline-only flow.
 */
export async function handleReferralInviteLink(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) { await ctx.reply(t('error_generic_request', lang)); return; }

    const username = ctx.botInfo?.username;
    const link = username
      ? `https://t.me/${username}?start=${user.referralCode}`
      : `کد دعوت شما: ${user.referralCode}`;

    const message = [
      t('referral_invite_title', lang),
      '',
      `\`${link}\``,
      '',
      t('referral_invite_hint', lang),
    ].join('\n');

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: generateReferralInlineKeyboard(lang).reply_markup,
    });
  } catch (err) {
    logger.error({ err }, '[bot] handleReferralInviteLink error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

/**
 * Referral: list how many users this person referred + recent joiners.
 */
export async function handleReferralMyReferrals(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) { await ctx.reply(t('error_generic_request', lang)); return; }

    const total = await User.countDocuments({ referredBy: user._id });
    const recent = await User.find({ referredBy: user._id })
      .sort({ createdAt: -1 }).limit(10).lean();

    const lines = recent.length
      ? recent.map((u, i) => `${i + 1}. ${u.firstName || u.username || u.telegramId} — ${new Date(u.createdAt).toLocaleDateString()}`).join('\n')
      : t('referral_none_yet', lang);

    const message = [
      t('referral_my_title', lang, { count: total }),
      '',
      lines,
    ].join('\n');

    await ctx.reply(message, { reply_markup: generateReferralInlineKeyboard(lang).reply_markup });
  } catch (err) {
    logger.error({ err }, '[bot] handleReferralMyReferrals error');
    await ctx.reply(t('error_generic_request', lang));
  }
}

/**
 * Referral: show accumulated referral commission / earnings.
 */
export async function handleReferralEarnings(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) { await ctx.reply(t('error_generic_request', lang)); return; }

    const message = [
      t('referral_earnings_title', lang),
      '',
      t('referral_earnings_commission', lang, { commission: user.referralCommission || 0 }),
      t('referral_earnings_wallet', lang, { balance: user.walletBalance || 0 }),
    ].join('\n');

    await ctx.reply(message, { reply_markup: generateReferralInlineKeyboard(lang).reply_markup });
  } catch (err) {
    logger.error({ err }, '[bot] handleReferralEarnings error');
    await ctx.reply(t('error_generic_request', lang));
  }
}
