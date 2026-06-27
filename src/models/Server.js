import mongoose from 'mongoose';

const serverSchema = new mongoose.Schema({
  name: { type: String, required: true },
  region: { type: String, required: true, index: true },
  country: String,
  port: { type: Number, default: 443 },
  maxCapacity: { type: Number, default: 1000 },
  currentLoad: { type: Number, default: 0 },
  isDedicated: { type: Boolean, default: false },
  dedicatedTo: mongoose.Schema.Types.ObjectId,
  tags: [String],
  salesEnabled: { type: Boolean, default: true, index: true },
  healthy: { type: Boolean, default: true },
  lastHealthCheck: Date,
  createdAt: { type: Date, default: Date.now },
});

serverSchema.index({ region: 1, healthy: 1 });

export default mongoose.model('Server', serverSchema);
