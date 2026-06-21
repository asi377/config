import mongoose from 'mongoose';

const fraudLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    ruleName: {
      type: String,
      required: [true, 'Rule name is required'],
      trim: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    actionTaken: {
      type: String,
      enum: ['none', 'warning', 'suspension', 'ban', 'review'],
      default: 'none',
    },
    resolved: {
      type: Boolean,
      default: false,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: '',
      maxlength: [2000, 'Notes cannot exceed 2000 characters'],
    },
  },
  { timestamps: true }
);

fraudLogSchema.index({ userId: 1, createdAt: -1 });
fraudLogSchema.index({ severity: 1, resolved: 1 });
fraudLogSchema.index({ ruleName: 1, createdAt: -1 });

export default mongoose.model('FraudLog', fraudLogSchema);
