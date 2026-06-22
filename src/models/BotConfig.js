import mongoose from 'mongoose';

const botMenuSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, 'Menu button text is required'],
      trim: true,
    },
    actionId: {
      type: String,
      required: [true, 'Menu action ID is required'],
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    row: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const botConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'singleton',
      unique: true,
    },
    welcomeText: {
      type: String,
      default: 'به ربات خوش آمدید! لطفاً یکی از گزینه‌های زیر را انتخاب کنید:',
    },
    smsBankRegex: {
      type: String,
      default: '',
    },
    cryptoPaymentEnabled: {
      type: Boolean,
      default: false,
    },
    botMenus: {
      type: [botMenuSchema],
      default: [],
    },
  },
  { timestamps: true }
);

botConfigSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ key: 'singleton' });
  if (!doc) {
    doc = await this.create({ key: 'singleton' });
  }
  return doc;
};

export default mongoose.model('BotConfig', botConfigSchema);
