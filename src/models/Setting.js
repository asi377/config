import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      unique: true,
      required: [true, 'Setting key is required'],
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Setting value is required'],
    },
    group: {
      type: String,
      default: 'general',
      trim: true,
      index: true,
    },
    label: {
      type: String,
      default: '',
      trim: true,
    },
    type: {
      type: String,
      enum: ['string', 'number', 'boolean', 'json', 'text', 'url', 'secret'],
      default: 'string',
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
    isSecret: {
      type: Boolean,
      default: false,
    },
    editable: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 100,
      index: true,
    },
  },
  { timestamps: true }
);

settingSchema.statics.get = async function (key, defaultValue = null) {
  const doc = await this.findOne({ key }).lean();
  return doc ? doc.value : defaultValue;
};

settingSchema.statics.set = async function (key, value, meta = {}) {
  return this.findOneAndUpdate(
    { key },
    { $set: { value, ...meta } },
    { upsert: true, returnDocument: 'after' },
  );
};

settingSchema.index({ group: 1, sortOrder: 1 });

export default mongoose.model('Setting', settingSchema);
