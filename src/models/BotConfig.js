import mongoose from 'mongoose';

const botConfigSchema = new mongoose.Schema({
  welcomeText: String,
  smsBankRegex: String,
  cryptoPaymentEnabled: { type: Boolean, default: false },
  botMenus: [String],
  updatedAt: { type: Date, default: Date.now },
});

botConfigSchema.statics.getSingleton = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({
      welcomeText: 'Welcome to HORNET VPN',
      botMenus: ['buy', 'account', 'support'],
    });
  }
  return config;
};

export default mongoose.model('BotConfig', botConfigSchema);
