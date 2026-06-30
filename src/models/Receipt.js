import mongoose from 'mongoose';

const receiptSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      default: null,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    photoFileId: {
      type: String,
      required: [true, 'Receipt photo is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: [
          'pending',
          'pending_payment',
          'approved',
          'rejected',
          'sms_matched',
          'paid',
        ],
        message: '{VALUE} is not a valid receipt status',
      },
      default: 'pending',
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    smsMatchedAt: {
      type: Date,
      default: null,
    },
    gateway: {
      type: String,
      default: null,
    },
    gatewayPaymentId: {
      type: String,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    autoApproved: {
      type: Boolean,
      default: false,
    },
    fraudScore: {
      type: Number,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

receiptSchema.index({ userId: 1, status: 1 });
receiptSchema.index({ status: 1, createdAt: -1 });
receiptSchema.index({ status: 1, smsMatchedAt: 1 });

export default mongoose.model('Receipt', receiptSchema);
