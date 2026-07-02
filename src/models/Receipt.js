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
      // Optional: auto card-to-card ("I paid") receipts have no photo and are
      // matched/approved purely from the forwarded bank SMS. Manual-upload
      // receipts still carry a photo.
      type: String,
      default: null,
      trim: true,
    },
    method: {
      // 'auto'  → user tapped "I paid", awaiting SMS match
      // 'manual'→ user uploaded a receipt photo, awaiting admin review
      type: String,
      enum: ['auto', 'manual'],
      default: 'manual',
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: [
          'pending',
          'pending_payment',
          'approved',
          'auto_approved',
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
    // Subscription provisioned for this receipt (set on approval) — lets the
    // "I paid" poll / SMS-approve find the tunnel to deliver configs.
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    // Card-to-card gating: the user must tap "I paid" before configs are sent.
    userClaimedPaid: {
      type: Boolean,
      default: false,
    },
    // Idempotency guard so configs are delivered exactly once.
    configDeliveredAt: {
      type: Date,
      default: null,
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
