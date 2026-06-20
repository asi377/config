import 'dotenv/config';
import { Telegraf, session, Scenes } from 'telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent'; // اضافه شده برای عبور از فیلترینگ لوکال
import mongoose from 'mongoose';
import {
    startCommand,
    handleMainMenu,
    handleProfile,
    handleBuyRenew,
    handleMySubscriptions,
    handleCreateSubLink,
    handlePlanSelection,
    handleCheckout,
    handleMockRecharge,
    registerScenes,
} from './controllers/botController.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI =
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vpn-panel';

// پورت پروکسی سیستم شما (اگر از V2rayN یا Nekoray استفاده می‌کنید معمولاً ۱۰۸۰۸ یا ۱۰۸۰۹ است)
const PROXY_URL = 'http://127.0.0.1:9910';

if (!BOT_TOKEN) {
    console.error('BOT_TOKEN environment variable is required');
    process.exit(1);
}

// تنظیمات ایجنت پروکسی
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

// اتصال پروکسی به هسته ربات
const bot = new Telegraf(BOT_TOKEN, {
    telegram: {
        agent: proxyAgent,
    },
});

const stage = new Scenes.Stage();
await registerScenes(stage);

bot.use(session());
bot.use(stage.middleware());

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

bot.start(startCommand);

bot.action('main_menu', handleMainMenu);
bot.action('profile', handleProfile);
bot.action('buy_renew', handleBuyRenew);
bot.action('my_subscriptions', handleMySubscriptions);
bot.action('create_sublink', handleCreateSubLink);

bot.action(/^select_plan_(.+)$/, handlePlanSelection);
bot.action(/^checkout_(.+)$/, handleCheckout);
bot.action('recharge_wallet', handleMockRecharge);

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

async function launch() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        await bot.launch();
        console.log('Bot is running');
    } catch (err) {
        console.error('Failed to launch bot:', err.message);
        process.exit(1);
    }
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

launch();
