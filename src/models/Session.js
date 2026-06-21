import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    tokenId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
    },
    deviceInfo: {
      userAgent: { type: String, default: '' },
      platform: { type: String, default: '' },
      ip: { type: String, default: '' },
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
    refreshExpiresAt: {
      type: Date,
      required: true,
    },
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  { timestamps: true }
);

sessionSchema.index({ adminId: 1, isRevoked: 1 });
sessionSchema.index({ tokenId: 1, isRevoked: 1 });

export default mongoose.model('Session', sessionSchema);
