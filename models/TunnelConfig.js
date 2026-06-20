import mongoose from 'mongoose';

const tunnelConfigSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: [true, 'Subscription reference is required'],
      index: true,
    },
    uuid: {
      type: String,
      required: [true, 'UUID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Config name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters'],
    },
    allocatedQuotaBytes: {
      type: Number,
      default: null,
      min: [0, 'Allocated quota cannot be negative'],
      validate: {
        validator: function (v) {
          if (v === null) return true;
          if (!this.subscriptionId) return true;
          return v >= 0;
        },
        message: 'Invalid allocated quota',
      },
    },
    usedQuotaBytes: {
      type: Number,
      default: 0,
      min: [0, 'Used quota cannot be negative'],
    },
    isGuestLink: {
      type: Boolean,
      default: false,
      index: true,
    },
    guestExpireDate: {
      type: Date,
      default: null,
    },
    strikeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

tunnelConfigSchema.index({ subscriptionId: 1, isActive: 1 });
tunnelConfigSchema.index({ isGuestLink: 1, guestExpireDate: 1 });
tunnelConfigSchema.index({ isGuestLink: 1, isActive: 1 });

// Virtual: remaining quota for this specific link
tunnelConfigSchema.virtual('remainingQuotaBytes').get(function () {
  if (this.allocatedQuotaBytes === null) return null;
  return Math.max(0, this.allocatedQuotaBytes - this.usedQuotaBytes);
});

// Virtual: is this link exhausted (quota used up)
tunnelConfigSchema.virtual('isQuotaExhausted').get(function () {
  if (this.allocatedQuotaBytes === null) return false;
  return this.usedQuotaBytes >= this.allocatedQuotaBytes;
});

// Virtual: is this guest link expired
tunnelConfigSchema.virtual('isGuestExpired').get(function () {
  if (!this.isGuestLink || !this.guestExpireDate) return false;
  return new Date() >= this.guestExpireDate;
});

// Virtual: should auto-disable (guest: quota exhausted OR time expired)
tunnelConfigSchema.virtual('shouldAutoDisable').get(function () {
  if (!this.isGuestLink) return false;
  return this.isQuotaExhausted || this.isGuestExpired;
});

// Pre-save: auto-deactivate guest links when conditions met
tunnelConfigSchema.pre('save', function () {
  if (this.isGuestLink && this.shouldAutoDisable) {
    this.isActive = false;
  }
});

export default mongoose.model('TunnelConfig', tunnelConfigSchema);
