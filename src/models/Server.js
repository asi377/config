import mongoose from 'mongoose';

const serverSchema = new mongoose.Schema({
  name: { type: String, required: true },
  region: { type: String, required: true, index: true },
  country: String,
  ipAddress: String,
  domain: String,
  port: { type: Number, default: 443 },
  xrayApiPort: { type: Number, default: 10085 },
  maxCapacity: { type: Number, default: 1000 },
  currentActiveUsers: { type: Number, default: 0 },
  currentLoad: { type: Number, default: 0 },
  isDedicated: { type: Boolean, default: false },
  dedicatedTo: mongoose.Schema.Types.ObjectId,
  tags: [String],
  salesEnabled: { type: Boolean, default: true, index: true },
  status: {
    type: String,
    enum: ['provisioning', 'claiming', 'active', 'maintenance', 'offline'],
    default: 'provisioning',
    index: true,
  },
  healthStatus: {
    type: String,
    enum: ['healthy', 'degraded', 'unhealthy', 'unknown'],
    default: 'unknown',
  },
  healthy: { type: Boolean, default: true },
  nodeToken: { type: String, index: true, sparse: true },
  lastHeartbeat: Date,
  lastHealthCheck: Date,
  lastCredentialRotation: Date,
  consecutiveFailures: { type: Number, default: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

serverSchema.index({ region: 1, healthy: 1 });

serverSchema.virtual('loadPercent').get(function () {
  return this.maxCapacity > 0
    ? Math.round(((this.currentActiveUsers || 0) / this.maxCapacity) * 1000) / 10
    : 0;
});

serverSchema.set('toJSON', { virtuals: true });
serverSchema.set('toObject', { virtuals: true });

export default mongoose.model('Server', serverSchema);
