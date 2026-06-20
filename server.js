import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { Telegraf, session, Scenes } from 'telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent';

import adminApiRouter from './routes/adminApi.js';
import webhookApiRouter from './routes/webhookApi.js';
import enterpriseAdminRouter from './routes/adminEnterprise.js';
import {
  startCommand,
  handleMainMenu,
  handleProfile,
  handleBuyRenew,
  handleCategorySelection,
  handleMySubscriptions,
  handleCreateSubLink,
  handlePlanSelection,
  handleCheckout,
  handleCardPayment,
  handleAutoCardPayment,
  handleMockRecharge,
  handleFreeTrial,
  adminCommand,
  handleAdminMetrics,
  handleAdminBackup,
  handleAdminBack,
  handleAdminDashboard,
  handleAdminUsers,
  handleAdminUserResetAll,
  handleAdminServers,
  handleAdminPlans,
  handleAdminFinance,
  handleAdminFinanceDaily,
  handleAdminBot,
  handleAdminBroadcast,
  handleAdminBandwidth,
  handleAdminSecurity,
  handleAdminAnalytics,
  handleAdminTickets,
  handleReceiptAction,
  registerScenes,
} from './controllers/botController.js';
import cronService from './services/cronService.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT, 10) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vpn-panel';
const PROXY_URL = process.env.PROXY_URL || 'http://127.0.0.1:9910';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN environment variable is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/admin', adminApiRouter);
app.use('/api/webhook', webhookApiRouter);
app.use('/api/enterprise', enterpriseAdminRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Telegraf Bot
// ---------------------------------------------------------------------------

const telegramConfig = {};
if (process.env.NODE_ENV !== 'production') {
  telegramConfig.agent = new HttpsProxyAgent(PROXY_URL);
}

const bot = new Telegraf(BOT_TOKEN, {
  telegram: telegramConfig,
});

app.set('bot', bot);

const stage = new Scenes.Stage();
await registerScenes(stage);

// ---------------------------------------------------------------------------
// Rate limiter — max 1 request per 2 seconds per user
// ---------------------------------------------------------------------------

const rateLimitMap = new Map();
setInterval(() => rateLimitMap.clear(), 3600000);

bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const now = Date.now();
  const last = rateLimitMap.get(userId) ?? 0;

  if (now - last < 2000) {
    return;
  }

  rateLimitMap.set(userId, now);
  return next();
});

bot.use(session());
bot.use(stage.middleware());

bot.start(startCommand);

bot.action('main_menu', handleMainMenu);
bot.action('profile', handleProfile);
bot.action('buy_renew', handleBuyRenew);
bot.action('my_subscriptions', handleMySubscriptions);
bot.action('create_sublink', handleCreateSubLink);

bot.action(/^category_(.+)$/, handleCategorySelection);
bot.action(/^select_plan_(.+)$/, handlePlanSelection);
bot.action(/^checkout_(.+)$/, handleCheckout);
bot.action(/^cardpay_(.+)$/, handleCardPayment);
bot.action(/^autocardpay_(.+)$/, handleAutoCardPayment);
bot.action('recharge_wallet', handleMockRecharge);
bot.action('free_trial', handleFreeTrial);

bot.command('admin', adminCommand);
bot.action('admin_metrics', handleAdminMetrics);
bot.action('admin_backup', handleAdminBackup);
bot.action('admin_back', handleAdminBack);

bot.action('admin_dashboard', handleAdminDashboard);
bot.action('admin_users', handleAdminUsers);
bot.action('admin_user_reset_all', handleAdminUserResetAll);
bot.action('admin_servers', handleAdminServers);
bot.action('admin_plans', handleAdminPlans);
bot.action('admin_finance', handleAdminFinance);
bot.action('admin_finance_daily', handleAdminFinanceDaily);
bot.action('admin_bot', handleAdminBot);
bot.action(/^admin_broadcast_(.+)$/, handleAdminBroadcast);
bot.action('admin_bandwidth', handleAdminBandwidth);
bot.action('admin_security', handleAdminSecurity);
bot.action('admin_analytics', handleAdminAnalytics);
bot.action('admin_tickets', handleAdminTickets);

bot.action(/^receipt_(approve|reject)_(.+)$/, handleReceiptAction);

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

let httpServer;

async function launch() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    httpServer = app.listen(PORT, () => {
      console.log(`✓ Express API listening on port ${PORT}`);
    });

    await bot.launch();
    console.log('✓ Telegraf bot is running');

    cronService.start(bot);
  } catch (err) {
    console.error('Failed to launch:', err.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);

  const results = await Promise.allSettled([
    new Promise((resolve) => httpServer?.close(() => resolve())),
    bot.stop(signal),
    mongoose.disconnect(),
    cronService.stop(),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Shutdown error:', result.reason);
    }
  }

  console.log('Goodbye.');
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

launch();
