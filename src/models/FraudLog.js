import mongoose from 'mongoose';

const fraudLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: String,
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  score: { type: Number, default: 0, min: 0, max: 100 },
  resolved: { type: Boolean, default: false, index: true },
  resolvedBy: mongoose.Schema.Types.ObjectId,
  resolvedAt: Date,
  notes: String,
  createdAt: { type: Date, default: Date.now, index: true },
});

export default mongoose.model('FraudLog', fraudLogSchema);
