import mongoose from 'mongoose';

const requiredChannelSchema = new mongoose.Schema({
  chatId: { type: String, required: true },
  title: { type: String, default: '' },
  inviteLink: { type: String, default: '' },
}, { _id: false });

const followUpButtonSchema = new mongoose.Schema({
  text: { type: String, required: true },
  actionId: { type: String, required: true },
}, { _id: false });

const botMenuItemSchema = new mongoose.Schema({
  actionId: { type: String, required: true },
  text: { type: String, required: true },
  order: { type: Number, default: 0 },
  row: { type: Number, default: 0 },
  parentId: { type: String, default: null },
  type: { type: String, enum: ['builtin', 'custom'], default: 'builtin' },
  messageText: { type: String, default: '' },
  followUpButtons: { type: [followUpButtonSchema], default: [] },
}, { _id: false });

const botConfigSchema = new mongoose.Schema({
  welcomeText: String,
  smsBankRegex: String,
  cryptoPaymentEnabled: { type: Boolean, default: false },
  botMenus: { type: [botMenuItemSchema], default: [] },
  channelGateEnabled: { type: Boolean, default: false },
  requiredChannels: { type: [requiredChannelSchema], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

// Default menu mirrors today's hardcoded mainMenuKeyboard so the bot keeps
// working immediately after migrating to the DB-driven menu generator.
const DEFAULT_BOT_MENUS = [
  { actionId: 'my_subscriptions', text: '📋 سرویس‌های من', order: 0, row: 0, type: 'builtin' },
  { actionId: 'buy_renew', text: '🛒 خرید اشتراک', order: 1, row: 1, type: 'builtin' },
  { actionId: 'free_trial', text: '🎁 طرح آزمایشی', order: 2, row: 2, type: 'builtin' },
  { actionId: 'profile', text: '📊 پروفایل کاربری', order: 3, row: 3, type: 'builtin' },
];

botConfigSchema.statics.getSingleton = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({
      welcomeText: 'Welcome to HORNET VPN',
      botMenus: DEFAULT_BOT_MENUS,
    });
  }
  return config;
};

export default mongoose.model('BotConfig', botConfigSchema);
