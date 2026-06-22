import mongoose from 'mongoose';
import crypto from 'crypto';

const serverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Server name is required'],
      unique: true,
      trim: true,
    },
    ipAddress: {
      type: String,
      required: [true, 'IP address is required'],
      trim: true,
    },
    ipv6Address: {
      type: String,
      default: null,
      trim: true,
    },
    domain: {
      type: String,
      default: null,
      trim: true,
    },
    port: {
      type: Number,
      required: [true, 'Port is required'],
      min: [1, 'Port must be between 1 and 65535'],
      max: [65535, 'Port must be between 1 and 65535'],
    },
    xrayApiPort: {
      type: Number,
      required: [true, 'Xray API port is required'],
      min: [1, 'Port must be between 1 and 65535'],
      max: [65535, 'Port must be between 1 and 65535'],
    },
    maxCapacity: {
      type: Number,
      required: [true, 'Max capacity is required'],
      min: [1, 'Max capacity must be at least 1'],
    },
    currentActiveUsers: {
      type: Number,
      default: 0,
      min: [0, 'Active users cannot be negative'],
    },
    region: {
      type: String,
      default: 'unknown',
      trim: true,
      index: true,
    },
    country: {
      type: String,
      default: null,
      trim: true,
    },
    city: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'maintenance', 'offline', 'provisioning'],
        message: '{VALUE} is not a valid server status',
      },
      default: 'provisioning',
      index: true,
    },
    healthStatus: {
      type: String,
      enum: ['healthy', 'degraded', 'unhealthy', 'unknown'],
      default: 'unknown',
    },
    nodeToken: {
      type: String,
      unique: true,
      sparse: true,
    },
    nodeVersion: {
      type: String,
      default: null,
    },
    lastHeartbeat: {
      type: Date,
      default: null,
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
      min: 0,
    },
    salesEnabled: {
      type: Boolean,
      default: true,
    },
    coefficient: {
      type: Number,
      required: true,
      default: 1.0,
      min: [0.1, 'Coefficient must be at least 0.1'],
      max: [10.0, 'Coefficient cannot exceed 10.0'],
    },
    lastCredentialRotation: {
      type: Date,
      default: null,
    },
    tlsCertFingerprint: {
      type: String,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    isDedicated: {
      type: Boolean,
      default: false,
    },
    dedicatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

serverSchema.index({ status: 1, currentActiveUsers: 1 });
serverSchema.index({ region: 1, status: 1, salesEnabled: 1 });

serverSchema.virtual('loadPercent').get(function () {
  if (this.maxCapacity === 0) return 100;
  return Number(((this.currentActiveUsers / this.maxCapacity) * 100).toFixed(1));
});

serverSchema.virtual('remainingCapacity').get(function () {
  return Math.max(0, this.maxCapacity - this.currentActiveUsers);
});

serverSchema.statics.generateNodeToken = function () {
  return 'hnt_' + crypto.randomBytes(32).toString('hex');
};

export default mongoose.model('Server', serverSchema);
