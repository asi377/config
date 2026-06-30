import mongoose from 'mongoose';

const healthCheckLogSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Server',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['healthy', 'degraded', 'unhealthy', 'offline'],
      required: true,
      index: true,
    },
    responseTime: { type: Number, default: 0 },
    cpuPercent: { type: Number, default: 0 },
    memoryPercent: { type: Number, default: 0 },
    diskPercent: { type: Number, default: 0 },
    xrayStatus: { type: String, default: 'unknown' },
    errorMessage: { type: String, default: null },
    consecutiveFailures: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

healthCheckLogSchema.index({ serverId: 1, createdAt: -1 });
healthCheckLogSchema.index({ status: 1, createdAt: -1 });
healthCheckLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export default mongoose.model('HealthCheckLog', healthCheckLogSchema);
