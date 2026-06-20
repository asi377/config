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
  },
  { timestamps: true }
);

settingSchema.statics.get = async function (key, defaultValue = null) {
  const doc = await this.findOne({ key }).lean();
  return doc ? doc.value : defaultValue;
};

settingSchema.statics.set = async function (key, value) {
  return this.findOneAndUpdate(
    { key },
    { $set: { value } },
    { upsert: true, new: true },
  );
};

export default mongoose.model('Setting', settingSchema);
