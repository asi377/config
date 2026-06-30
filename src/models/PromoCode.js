import mongoose from 'mongoose';

const promoCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  discountPercent: { type: Number, required: true, min: 0, max: 100 },
  maxDiscountAmount: { type: Number, default: null },
  usageLimit: { type: Number, default: null },
  usedCount: { type: Number, default: 0 },
  expiresAt: Date,
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('PromoCode', promoCodeSchema);
