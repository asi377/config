import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    index: true,
  },
  priority: {
    type: Number,
    default: 0,
    min: -10,
    max: 10,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  error: {
    message: String,
    stack: String,
  },
  retryCount: {
    type: Number,
    default: 0,
  },
  maxRetries: {
    type: Number,
    default: 3,
  },
  scheduledAt: {
    type: Date,
    default: Date.now,
  },
  startedAt: Date,
  completedAt: Date,
  workerId: String,
}, { timestamps: true });

jobSchema.index({ status: 1, priority: -1, scheduledAt: 1 });
jobSchema.index({ type: 1, status: 1 });
jobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 * 30 });

export default mongoose.model('Job', jobSchema);
