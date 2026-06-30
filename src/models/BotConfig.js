import mongoose from 'mongoose';

const localizedTextSchema = {
  en: { type: String, default: '' },
  fa: { type: String, default: '' },
  ru: { type: String, default: '' },
};

const botMenuButtonSchema = new mongoose.Schema(
  {
    // Not required: legacy botMenus documents stored an `actionId` shape without
    // a buttonId, and making this mandatory broke every BotConfig.save().
    buttonId: { type: String, default: '' },
    text: localizedTextSchema,
    row: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    action: {
      type: {
        type: String,
        enum: ['nextMenu', 'staticAction'],
        default: 'staticAction',
      },
      nextMenuId: { type: String, default: null },
      staticAction: { type: String, default: null },
    },
  },
  { _id: false },
);

// Admin-authored "content" buttons: a label that, when tapped, shows a custom
// message and (optionally) some link buttons. Deliberately simple — these do
// NOT touch the bot's complex-logic buttons (buy/wallet/etc.); they only let an
// admin add extra informational buttons from the panel.
const customButtonSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },          // stable id, e.g. "tutorial"
    label: localizedTextSchema,                      // text shown ON the button
    text: localizedTextSchema,                       // message shown when tapped
    links: [{                                        // optional URL sub-buttons
      label: { type: String, default: '' },
      url: { type: String, default: '' },
    }],
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const botConfigSchema = new mongoose.Schema({
  welcomeText: localizedTextSchema,
  smsBankRegex: String,
  cryptoPaymentEnabled: { type: Boolean, default: false },
  botMenus: [botMenuButtonSchema],
  customButtons: [customButtonSchema],
  updatedAt: { type: Date, default: Date.now },
});

botConfigSchema.statics.getSingleton = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({
      welcomeText: {
        en: 'Welcome to HORNET VPN',
        fa: 'به HORNET VPN خوش آمدید',
        ru: 'Добро пожаловать в HORNET VPN',
      },
      botMenus: [
        {
          buttonId: 'buy',
          text: { en: 'Buy', fa: 'خرید', ru: 'Купить' },
          row: 0,
          order: 0,
          action: { type: 'staticAction', staticAction: 'buy_renew' },
        },
        {
          buttonId: 'account',
          text: { en: 'Account', fa: 'حساب کاربری', ru: 'Аккаунт' },
          row: 1,
          order: 0,
          action: { type: 'staticAction', staticAction: 'profile' },
        },
        {
          buttonId: 'support',
          text: { en: 'Support', fa: 'پشتیبانی', ru: 'Поддержка' },
          row: 2,
          order: 0,
          action: { type: 'staticAction', staticAction: 'contact_support' },
        },
      ],
    });
  }
  return config;
};

export default mongoose.model('BotConfig', botConfigSchema);
