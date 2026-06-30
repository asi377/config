import mongoose from 'mongoose';

const localizedTextSchema = {
  en: { type: String, default: '' },
  fa: { type: String, default: '' },
  ru: { type: String, default: '' },
};

const botMenuButtonSchema = new mongoose.Schema(
  {
    buttonId: { type: String, required: true },
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

const botConfigSchema = new mongoose.Schema({
  welcomeText: localizedTextSchema,
  smsBankRegex: String,
  cryptoPaymentEnabled: { type: Boolean, default: false },
  botMenus: [botMenuButtonSchema],
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
