import mongoose from 'mongoose';

const serverMetricsSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Server',
      required: true,
      index: true,
    },
    cpuPercent: { type: Number, default: 0 },
    memoryPercent: { type: Number, default: 0 },
    memoryBytes: {
      total: { type: Number, default: 0 },
      available: { type: Number, default: 0 },
      used: { type: Number, default: 0 },
    },
    diskPercent: { type: Number, default: 0 },
    diskBytes: {
      total: { type: Number, default: 0 },
      used: { type: Number, default: 0 },
      free: { type: Number, default: 0 },
    },
    networkBytes: {
      rxBytes: { type: Number, default: 0 },
      txBytes: { type: Number, default: 0 },
    },
    loadAvg: [Number],
    uptimeSeconds: { type: Number, default: 0 },
    xrayStatus: { type: String, default: 'unknown' },
    activeConnections: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    timeseries: {
      timeField: 'createdAt',
      metaField: 'serverId',
      granularity: 'minutes',
    },
  }
);

serverMetricsSchema.index({ serverId: 1, createdAt: -1 });
serverMetricsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export default mongoose.model('ServerMetrics', serverMetricsSchema);
