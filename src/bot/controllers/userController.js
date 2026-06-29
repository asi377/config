import logger from '../../config/logger.js';

export async function startCommand(ctx) {
  try {
    const User = (await import('../../models/User.js')).default;
    const BotConfig = (await import('../../models/BotConfig.js')).default;
    const { generateDynamicMenuKeyboard } = await import('../keyboards.js');
    const telegramId = String(ctx.from.id);
    let user = await User.findOne({ telegramId });

    if (!user) {
      user = await User.create({
        telegramId,
        role: 'user',
      });
      logger.info({ telegramId }, '[bot] New user registered');
    }

    const config = await BotConfig.getSingleton();
    await ctx.msgQueue.sendMessage(
      ctx.chat.id,
      config.welcomeText || '👋 Welcome to HORNET VPN!\n\nChoose an option below:',
      generateDynamicMenuKeyboard(config.botMenus),
    );
  } catch (err) {
    logger.error({ err }, '[bot] startCommand error');
    await ctx.reply('Error: Could not process your request');
  }
}

export async function handleMainMenu(ctx) {
  const BotConfig = (await import('../../models/BotConfig.js')).default;
  const { generateDynamicMenuKeyboard } = await import('../keyboards.js');
  const config = await BotConfig.getSingleton();
  await ctx.editMessageText(config.welcomeText || 'Main Menu:', generateDynamicMenuKeyboard(config.botMenus));
}

export async function handleProfile(ctx) {
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const message = `👤 Profile\n\nTelegram ID: ${user?.telegramId}\nBalance: ${user?.walletBalance || 0} IRR\nReferral Code: ${user?.referralCode || 'N/A'}`;
    await ctx.editMessageText(message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '← Back', callback_data: 'main_menu' }],
        ],
      },
    });
  } catch (err) {
    logger.error({ err }, '[bot] handleProfile error');
  }
}

export async function handleBuyRenew(ctx) {
  const Plan = (await import('../../models/Plan.js')).default;
  const plans = await Plan.find({ isActive: true, salesEnabled: true }).lean();
  const keyboard = plans.map((p) => [
    { text: `${p.title} - ${p.basePrice} IRR`, callback_data: `select_plan_${p._id}` },
  ]);
  keyboard.push([{ text: '← Back', callback_data: 'main_menu' }]);

  await ctx.editMessageText('Select a plan:', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleMySubscriptions(ctx) {
  const Subscription = (await import('../../models/Subscription.js')).default;
  const subs = await Subscription.find({
    ownerId: (await (await import('../../models/User.js')).default.findOne({ telegramId: String(ctx.from.id) }))._id,
  });
  const text = subs.length > 0
    ? `📊 Your Subscriptions:\n${subs.map((s) => `Status: ${s.status}`).join('\n')}`
    : 'No active subscriptions';

  await ctx.editMessageText(text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '← Back', callback_data: 'main_menu' }],
      ],
    },
  });
}

export async function handleCreateSubLink(ctx) {
  await ctx.scene.enter('createSubLinkScene');
}

export async function handleGetConfig(ctx) {
  await ctx.reply('📥 Config file will be delivered shortly');
}

export async function handleFreeTrial(ctx) {
  await ctx.reply('🎉 Free trial period: 3 days (limited to 1GB)');
}

export async function handleCategorySelection(ctx) {
  const category = ctx.match[1];
  await ctx.reply(`Category: ${category}`);
}

export async function handlePlanSelection(ctx) {
  const planId = ctx.match[1];
  await ctx.reply(`Plan selected: ${planId}\n\nProceed to checkout?`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Confirm', callback_data: `checkout_${planId}` }],
        [{ text: '❌ Cancel', callback_data: 'main_menu' }],
      ],
    },
  });
}

export async function handleCheckout(ctx) {
  const planId = ctx.match[1];
  await ctx.editMessageText('Select payment method:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💳 Card to Card', callback_data: `cardpay_${planId}` }],
        [{ text: '🪙 Crypto', callback_data: 'crypto_payment' }],
        [{ text: '💰 Wallet', callback_data: `checkout_confirm_${planId}` }],
      ],
    },
  });
}

export async function handleCheckoutConfirm(ctx) {
  await ctx.reply('✅ Order confirmed!');
}

export async function handleCardPayment(ctx) {
  const planId = ctx.match[1];
  await ctx.reply(`Transfer to: 5022-2910-XXXX-XXXX\nAmount: [Plan Price]\n\nAfter transfer, upload receipt.`);
  await ctx.scene.enter('receiptUploadScene');
}

export async function handleAutoCardPayment(ctx) {
  await ctx.reply('🔄 Setting up automatic payment...');
}

export async function handleConfigClientPick(ctx) {
  const client = ctx.match[1];
  const subId = ctx.match[2];
  await ctx.reply(`📥 Config for ${client} will be sent`);
}
