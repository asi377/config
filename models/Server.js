import mongoose from 'mongoose';

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
      match: [/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Invalid IP address format'],
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
    status: {
      type: String,
      enum: {
        values: ['active', 'maintenance'],
        message: '{VALUE} is not a valid server status',
      },
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

serverSchema.index({ status: 1, currentActiveUsers: 1 });

serverSchema.virtual('loadPercent').get(function () {
  if (this.maxCapacity === 0) return 100;
  return Number(((this.currentActiveUsers / this.maxCapacity) * 100).toFixed(1));
});

serverSchema.virtual('remainingCapacity').get(function () {
  return Math.max(0, this.maxCapacity - this.currentActiveUsers);
});

export default mongoose.model('Server', serverSchema);
