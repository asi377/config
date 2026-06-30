import { Telegraf, session, Scenes } from 'telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { botRateLimit } from '../middlewares/rateLimiter.js';
import BroadcastService from '../services/admin/BroadcastService.js';
import createSubLinkScene from './scenes/createSubLinkScene.js';
import receiptUploadScene from './scenes/receiptUploadScene.js';
import languageScene from './scenes/languageScene.js';
import walletTopupScene from './scenes/walletTopupScene.js';
import * as userController from './controllers/userController.js';
import * as adminController from './controllers/adminController.js';
import * as resellerController from './controllers/resellerController.js';
import BullMQManager from '../queue/bullmq.js';
import { resolveUserMiddleware } from './middlewares/userResolver.js';
import { languageMiddleware } from './middlewares/languageMiddleware.js';
import { forceSubscribeMiddleware } from './middlewares/forceSubscribeMiddleware.js';
import { handleForceSubscribeRecheck } from './controllers/forceSubscribeController.js';
import { matchReplyButton } from './replyKeyboardRouter.js';
import { matchCustomButton, renderCustomButton } from './customButtons.js';
import { mainReplyKeyboard } from './keyboards.js';

/**
 * Queue-based Telegram message dispatcher.
 * Respects Telegram's 30 msg/s limit by throttling through BullMQ.
 */
class BotMessageQueue {
  constructor(bot) {
    this.bot = bot;
    this.queue = BullMQManager.getQueue('telegram-out');
    if (!this.queue) {
      this.queue = BullMQManager.createQueue('telegram-out', {
        concurrency: 5,
        limiter: { max: 30, duration: 1000 }, // 30 msg/sec = Telegram safe limit
        attempts: 3,
        backoffDelay: 1000,
      });
    }
  }

  async sendMessage(chatId, text, extra = {}) {
    await this.queue.add('sendMessage', { chatId, text, extra }, {
      removeOnComplete: 1000,
      removeOnFail: 100,
    });
  }

  async sendPhoto(chatId, photo, extra = {}) {
    await this.queue.add('sendPhoto', { chatId, photo, extra }, {
      removeOnComplete: 1000,
      removeOnFail: 100,
    });
  }

  async sendDocument(chatId, document, extra = {}) {
    await this.queue.add('sendDocument', { chatId, document, extra }, {
      removeOnComplete: 1000,
      removeOnFail: 100,
    });
  }

  registerWorker() {
    const worker = BullMQManager.createWorker('telegram-out', async (job) => {
      if (job.name === 'broadcast') {
        return BroadcastService.processBroadcastJob(this.bot, job.data);
      }

      const { chatId, text, photo, document, extra } = job.data;
      try {
        if (text) await this.bot.telegram.sendMessage(chatId, text, extra);
        else if (photo) await this.bot.telegram.sendPhoto(chatId, photo, extra);
        else if (document) await this.bot.telegram.sendDocument(chatId, document, extra);
      } catch (err) {
        // Handle Telegram rate limit (429) — auto-retry handled by BullMQ
        if (err?.response?.error_code === 429) {
          const retryAfter = err.response.parameters?.retry_after || 5;
          logger.warn({ chatId, retryAfter }, '[bot-queue] Rate limited, will retry');
          throw err; // BullMQ will retry with backoff
        }
        // Non-critical: skip message but don't crash
        if (err?.response?.error_code === 403) {
          logger.warn({ chatId }, '[bot-queue] Bot blocked by user');
          return;
        }
        logger.error({ err, chatId }, '[bot-queue] Send failed');
        throw err;
      }
    }, { concurrency: 5, limiter: { max: 30, duration: 1000 } });
    return worker;
  }
}

export function createBot() {
  const telegramConfig = {};
  if (config.proxyUrl) telegramConfig.agent = new HttpsProxyAgent(config.proxyUrl);

  const bot   = new Telegraf(config.botToken, { telegram: telegramConfig });
  const stage = new Scenes.Stage([createSubLinkScene, receiptUploadScene, languageScene, walletTopupScene]);

  // Attach queue to bot for use in controllers
  const msgQueue = new BotMessageQueue(bot);
  bot.context.msgQueue = msgQueue;
  msgQueue.registerWorker();

  bot.use(session());
  bot.use(resolveUserMiddleware());
  bot.use(languageMiddleware());
  bot.use(forceSubscribeMiddleware);
  bot.use(botRateLimit);

  // ── Scene-escape guard (runs BEFORE the Stage) ───────────────────────────────
  // If the user is stuck inside a scene/flow and taps a persistent menu button
  // (or /start, /restart, /menu), drop the active scene so the press is handled
  // as a normal navigation instead of being swallowed by the scene. This is what
  // makes the bottom keyboard always work and removes dead-ends.
  bot.use(async (ctx, next) => {
    const txt = ctx.message?.text;
    if (txt) {
      const isMenuBtn = !!matchReplyButton(txt) || txt === '🌐 Change Language'
        || !!(await matchCustomButton(txt));
      const isEscapeCmd = /^\/(start|restart|menu)\b/.test(txt);
      if ((isMenuBtn || isEscapeCmd) && ctx.session && ctx.session.__scenes) {
        ctx.session.__scenes = {};
      }
    }
    return next();
  });

  bot.use(stage.middleware());

  // ── User commands ────────────────────────────────────────────────────────────
  bot.start(userController.startCommand);
  bot.command('restart', userController.handleRestart);
  bot.command('menu', userController.handleMainMenu);
  bot.command('help', userController.handleHelp);
  bot.action('help', userController.handleHelp);

  bot.action('main_menu',        userController.handleMainMenu);
  bot.action('profile',          userController.handleProfile);
  bot.action('buy_renew',        userController.handleBuyRenew);
  bot.action('my_subscriptions', userController.handleMySubscriptions);
  bot.action(/^sub_detail_(.+)$/,  userController.handleSubscriptionDetail);
  bot.action(/^config_pick_(.+)$/, userController.handleConfigPick);
  bot.action(/^sub_rotate_(.+)$/,  userController.handleSubRotateConfig);
  bot.action('create_sublink',   userController.handleCreateSubLink);
  bot.action('get_config',       userController.handleGetConfig);
  bot.action('free_trial',       userController.handleFreeTrial);
  bot.action('update_uuid',      userController.handleUpdateUuid);
  bot.action('contact_support',  userController.handleContactSupport);
  bot.action('wallet_topup_start', userController.handleWalletTopupStart);

  bot.action(/^category_(.+)$/,          userController.handleCategorySelection);
  bot.action(/^select_plan_(.+)$/,       userController.handlePlanSelection);
  bot.action(/^checkout_(.+)$/,          userController.handleCheckout);
  bot.action(/^checkout_confirm_(.+)$/,  userController.handleCheckoutConfirm);
  bot.action(/^cardpay_(.+)$/,           userController.handleCardPayment);
  bot.action(/^autocardpay_(.+)$/,       userController.handleAutoCardPayment);
  bot.action(/^ipaid_(.+)$/,             userController.handleIPaid);
  bot.action(/^config_client_([a-z]+)_(.+)$/, userController.handleConfigClientPick);
  bot.action(/^extra_data_confirm_(\d+)_(.+)$/, userController.handleExtraDataConfirm);

  // ── Reseller flow ────────────────────────────────────────────────────────────
  bot.action('reseller_menu',  resellerController.handleResellerMenu);
  bot.action('reseller_panel', resellerController.handleResellerMiniPanel);
  bot.action(/^reseller_apply_(.+)$/, resellerController.handleResellerTierSelect);

  // ── Language switching ───────────────────────────────────────────────────────
  bot.action('change_language', (ctx) => ctx.scene.enter('languageScene'));
  bot.command('language', (ctx) => ctx.scene.enter('languageScene'));

  // ── Force-subscribe (mandatory channel join) ─────────────────────────────────
  bot.action('force_subscribe_recheck', handleForceSubscribeRecheck);

  // ── Admin-defined custom menu (layered on top of hardcoded flows) ───────────
  bot.action('custom_menu', async (ctx) => {
    const { renderAdminDefinedMenu } = await import('./services/BotConfigLoader.js');
    await renderAdminDefinedMenu(ctx, null);
  });
  bot.action(/^custom_menu_(.+)$/, async (ctx) => {
    const { renderAdminDefinedMenu } = await import('./services/BotConfigLoader.js');
    await renderAdminDefinedMenu(ctx, ctx.match[1]);
  });

  // ── Admin commands ───────────────────────────────────────────────────────────
  bot.command('admin', adminController.adminCommand);
  bot.command('restart_bot', adminController.handleAdminRestart);

  bot.action('admin_back',           adminController.handleAdminBack);
  bot.action('admin_dashboard',      adminController.handleAdminDashboard);
  bot.action('admin_metrics',        adminController.handleAdminMetrics);
  bot.action('admin_broadcast_menu', adminController.handleAdminBroadcastMenu);
  bot.action('admin_users',          adminController.handleAdminUsers);
  bot.action('admin_user_reset_all', adminController.handleAdminUserResetAll);
  bot.action('admin_servers',        adminController.handleAdminServers);
  bot.action('admin_plans',          adminController.handleAdminPlans);
  bot.action('admin_finance',        adminController.handleAdminFinance);
  bot.action('admin_finance_daily',  adminController.handleAdminFinanceDaily);
  bot.action('admin_bot',            adminController.handleAdminBot);
  bot.action('admin_bandwidth',      adminController.handleAdminBandwidth);
  bot.action('admin_security',       adminController.handleAdminSecurity);
  bot.action('admin_analytics',      adminController.handleAdminAnalytics);
  bot.action('admin_tickets',        adminController.handleAdminTickets);
  bot.action('admin_subscriptions',  adminController.handleAdminSubscriptions);
  bot.action('admin_receipts',       adminController.handleAdminReceipts);
  bot.action('admin_promocodes',     adminController.handleAdminPromoCodes);
  bot.action('admin_settings',       adminController.handleAdminSettings);
  bot.action('admin_backup',         adminController.handleAdminBackup);
  bot.action('admin_add_promo',      adminController.handleAdminAddPromo);

  bot.action(/^admin_broadcast_(.+)$/,     adminController.handleAdminBroadcast);
  bot.action(/^admin_plan_toggle_(.+)$/,   adminController.handleAdminPlanToggle);
  bot.action(/^admin_server_detail_(.+)$/, adminController.handleAdminServerDetail);
  bot.action(/^receipt_(approve|reject)_(.+)$/, adminController.handleReceiptAction);

  // ── Persistent reply-keyboard router ─────────────────────────────────────────
  const REPLY_ACTIONS = {
    buy_renew:          userController.handleBuyRenew,
    pricing_list:       userController.handlePricingList,
    my_subscriptions:   userController.handleMySubscriptions,
    free_trial:         userController.handleFreeTrial,
    profile:            userController.handleProfile,
    reseller_entry:     resellerController.handleResellerMenu,
    wallet_menu:        userController.handleWalletMenu,
    faq:                userController.handleFaq,
    connection_guide:   userController.handleConnectionGuide,
    contact_support:    userController.handleContactSupport,
  };

  bot.on('text', async (ctx, next) => {
    // The "Change Language" reply-keyboard label is always English.
    if (ctx.message.text === '🌐 Change Language') {
      return ctx.scene.enter('languageScene');
    }
    const action = matchReplyButton(ctx.message.text);
    if (action && REPLY_ACTIONS[action]) {
      if (action === 'reseller_entry' && ctx.user?.isReseller) {
        return resellerController.handleResellerMiniPanel(ctx);
      }
      return REPLY_ACTIONS[action](ctx);
    }
    // Admin-defined custom content buttons.
    const custom = await matchCustomButton(ctx.message.text);
    if (custom) return renderCustomButton(ctx, custom);
    return next();
  });

  // ── Broadcast text capture ───────────────────────────────────────────────────
  bot.on('text', async (ctx, next) => {
    const handled = await adminController.handleBroadcastText(ctx);
    if (!handled) return next();
  });

  logger.info('[bot] All handlers registered');
  return bot;
}
