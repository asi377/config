import mongoose from 'mongoose';

const sharedPaymentSubSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    paymentAmount: {
      type: Number,
      required: true,
      min: [0, 'Payment amount cannot be negative'],
    },
    paid: {
      type: Boolean,
      default: false,
    },
    paidAt: Date,
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner is required'],
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: [true, 'Plan is required'],
    },
    status: {
      type: String,
      enum: {
        values: ['pending_shared_payment', 'active', 'expired', 'suspended'],
        message: '{VALUE} is not a valid subscription status',
      },
      default: 'pending_shared_payment',
      index: true,
    },
    totalVolumeBytes: {
      type: Number,
      required: [true, 'Total volume is required'],
      min: [0, 'Total volume cannot be negative'],
      default: 0,
    },
    rolloverVolumeBytes: {
      type: Number,
      default: 0,
      min: [0, 'Rollover volume cannot be negative'],
    },
    usedVolumeBytes: {
      type: Number,
      default: 0,
      min: [0, 'Used volume cannot be negative'],
      validate: {
        validator: function (v) {
          return v <= this.totalVolumeBytes;
        },
        message: 'Used volume ({VALUE}) cannot exceed total volume ({TOTAL})',
      },
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
      default: Date.now,
    },
    expireDate: {
      type: Date,
      required: [true, 'Expire date is required'],
    },
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Server',
      default: null,
    },
    notified80Percent: {
      type: Boolean,
      default: false,
    },
    sharedPaymentDetails: [sharedPaymentSubSchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

subscriptionSchema.index({ ownerId: 1, status: 1 });
subscriptionSchema.index({ expireDate: 1 }, { expireAfterSeconds: 0 });
subscriptionSchema.index({ 'sharedPaymentDetails.userId': 1 });
subscriptionSchema.index({ status: 1, expireDate: 1 });

// Virtual: remaining data in the pool
subscriptionSchema.virtual('remainingVolumeBytes').get(function () {
  return Math.max(0, this.totalVolumeBytes - this.usedVolumeBytes);
});

// Virtual: rollover eligibility (renews before expiry with remaining data)
subscriptionSchema.virtual('rolloverEligibleBytes').get(function () {
  if (this.status !== 'active') return 0;
  const now = new Date();
  if (this.expireDate <= now) return 0;
  return this.remainingVolumeBytes;
});

// Instance method: check if all shared payments are complete
subscriptionSchema.methods.isSharedPaymentComplete = function () {
  if (!this.sharedPaymentDetails || this.sharedPaymentDetails.length === 0) {
    return true;
  }
  return this.sharedPaymentDetails.every((p) => p.paid);
};

// Instance method: calculate rollover volume for renewal
subscriptionSchema.methods.calculateRolloverBytes = function () {
  return this.rolloverEligibleBytes;
};

// Instance method: total quota allocated across all sub-links
subscriptionSchema.methods.allocatedSubLinkQuotaBytes = async function () {
  const TunnelConfig = mongoose.model('TunnelConfig');
  const result = await TunnelConfig.aggregate([
    { $match: { subscriptionId: this._id, isActive: true } },
    {
      $group: {
        _id: null,
        totalQuota: { $sum: '$allocatedQuotaBytes' },
      },
    },
  ]);
  return result.length > 0 ? result[0].totalQuota : 0;
};

export default mongoose.model('Subscription', subscriptionSchema);
