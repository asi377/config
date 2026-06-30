import mongoose from 'mongoose';

const serverMetricsSchema = new mongoose.Schema({
  serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Server', required: true, index: true },
  load: { type: Number, default: 0 },
  cpuUsage: Number,
  memoryUsage: Number,
  bandwidthIn: Number,
  bandwidthOut: Number,
  activeConnections: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now, index: true },
});

serverMetricsSchema.index({ serverId: 1, timestamp: -1 });

export default mongoose.model('ServerMetrics', serverMetricsSchema);
