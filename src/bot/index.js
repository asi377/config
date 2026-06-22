import { Telegraf, session, Scenes } from 'telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { botRateLimit } from '../middlewares/rateLimiter.js';
import createSubLinkScene from './scenes/createSubLinkScene.js';
import receiptUploadScene from './scenes/receiptUploadScene.js';
import * as userController from './controllers/userController.js';
import * as adminController from './controllers/adminController.js';

export function createBot() {
  const telegramConfig = {};
  if (config.proxyUrl) {
    telegramConfig.agent = new HttpsProxyAgent(config.proxyUrl);
  }

  const bot = new Telegraf(config.botToken, { telegram: telegramConfig });

  const stage = new Scenes.Stage();
  stage.register(createSubLinkScene);
  stage.register(receiptUploadScene);

  bot.use(session());
  bot.use(botRateLimit);
  bot.use(stage.middleware());

  bot.start(userController.startCommand);

  bot.action('main_menu', userController.handleMainMenu);
  bot.action('profile', userController.handleProfile);
  bot.action('buy_renew', userController.handleBuyRenew);
  bot.action('my_subscriptions', userController.handleMySubscriptions);
  bot.action('create_sublink', userController.handleCreateSubLink);

  bot.action(/^category_(.+)$/, userController.handleCategorySelection);
  bot.action(/^select_plan_(.+)$/, userController.handlePlanSelection);
  bot.action(/^checkout_(.+)$/, userController.handleCheckout);
  bot.action(/^cardpay_(.+)$/, userController.handleCardPayment);
  bot.action(/^autocardpay_(.+)$/, userController.handleAutoCardPayment);
  // REMOVED: mock recharge — dev-only feature, dangerous in production
  bot.action('free_trial', userController.handleFreeTrial);
  bot.action(/^checkout_confirm_(.+)$/, userController.handleCheckoutConfirm);

  bot.action('get_config', userController.handleGetConfig);
  bot.action(/^config_client_(.+)$/, userController.handleConfigClientPick);

  bot.command('admin', adminController.adminCommand);
  bot.action('admin_metrics', adminController.handleAdminMetrics);
  bot.action('admin_backup', adminController.handleAdminBackup);
  bot.action('admin_back', adminController.handleAdminBack);

  bot.action('admin_dashboard', adminController.handleAdminDashboard);
  bot.action('admin_users', adminController.handleAdminUsers);
  bot.action('admin_user_reset_all', adminController.handleAdminUserResetAll);
  bot.action('admin_servers', adminController.handleAdminServers);
  bot.action('admin_plans', adminController.handleAdminPlans);
  bot.action('admin_finance', adminController.handleAdminFinance);
  bot.action('admin_finance_daily', adminController.handleAdminFinanceDaily);
  bot.action('admin_bot', adminController.handleAdminBot);
  bot.action(/^admin_broadcast_(.+)$/, adminController.handleAdminBroadcast);
  bot.action('admin_bandwidth', adminController.handleAdminBandwidth);
  bot.action('admin_security', adminController.handleAdminSecurity);
  bot.action('admin_analytics', adminController.handleAdminAnalytics);
  bot.action('admin_tickets', adminController.handleAdminTickets);

  bot.action(/^receipt_(approve|reject)_(.+)$/, adminController.handleReceiptAction);

  bot.action('admin_subscriptions', adminController.handleAdminSubscriptions);
  bot.action('admin_receipts', adminController.handleAdminReceipts);
  bot.action('admin_promocodes', adminController.handleAdminPromoCodes);
  bot.action('admin_settings', adminController.handleAdminSettings);
  bot.action('admin_add_promo', adminController.handleAdminAddPromo);
  bot.action(/^admin_plan_toggle_(.+)$/, adminController.handleAdminPlanToggle);

  logger.info('Bot handlers registered');
  return bot;
}
