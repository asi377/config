import mongoose from 'mongoose';
import crypto from 'crypto';

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[crypto.randomInt(chars.length)]).join('');
}

const userSchema = new mongoose.Schema(
  {
    telegramId: {
      type: String,
      required: [true, 'Telegram ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: [0, 'Wallet balance cannot be negative'],
    },
    role: {
      type: String,
      enum: {
        values: ['user', 'support', 'superadmin', 'banned', 'reseller'],
        message: '{VALUE} is not a valid role',
      },
      default: 'user',
    },
    referralCode: {
      type: String,
      unique: true,
      trim: true,
      index: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    rank: {
      type: String,
      enum: ['egg', 'worker', 'hunter', 'queen'],
      default: 'egg',
      index: true,
    },
    totalSpent: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ role: 1 });

userSchema.pre('save', function () {
  if (!this.referralCode) {
    this.referralCode = generateReferralCode();
  }
});

export default mongoose.model('User', userSchema);
