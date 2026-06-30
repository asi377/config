import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
  type: { type: String, enum: ['string', 'number', 'boolean', 'json'], default: 'string' },
  description: String,
  updatedAt: { type: Date, default: Date.now },
});

settingSchema.statics.get = async function (key, defaultValue = null) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaultValue;
};

settingSchema.statics.set = async function (key, value, type = 'json') {
  return this.findOneAndUpdate(
    { key },
    { $set: { value, type, updatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export default mongoose.model('Setting', settingSchema);
