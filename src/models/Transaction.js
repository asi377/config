import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ['deposit', 'withdrawal', 'payment', 'refund', 'admin_adjustment', 'referral_bonus'],
        message: '{VALUE} is not a valid transaction type',
      },
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
    },
    currency: {
      type: String,
      default: 'IRR',
    },
    balanceBefore: {
      type: Number,
      default: 0,
    },
    balanceAfter: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      default: '',
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    referenceType: {
      type: String,
      enum: ['receipt', 'subscription', 'promo_code', 'admin', 'referral', 'refund'],
      default: null,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ referenceType: 1, referenceId: 1 });

export default mongoose.model('Transaction', transactionSchema);
