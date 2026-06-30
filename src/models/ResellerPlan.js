import mongoose from 'mongoose';

const resellerPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    // null = unlimited active accounts sold
    maxActiveAccounts: {
      type: Number,
      default: null,
      min: 0,
    },
    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    requiresApproval: {
      type: Boolean,
      default: true,
    },
    // one-off fee paid (via the existing payment flow) to upgrade into this tier
    applicationFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

resellerPlanSchema.index({ isActive: 1, sortOrder: 1 });

const DEFAULT_PLANS = [
  { name: 'tier1', displayName: 'Tier 1', maxActiveAccounts: 20, discountPercent: 15, requiresApproval: true, sortOrder: 1 },
  { name: 'tier2', displayName: 'Tier 2', maxActiveAccounts: 25, discountPercent: 20, requiresApproval: true, sortOrder: 2 },
  { name: 'tier3', displayName: 'Tier 3', maxActiveAccounts: 28, discountPercent: 22, requiresApproval: true, sortOrder: 3 },
  { name: 'tier4', displayName: 'Tier 4', maxActiveAccounts: 30, discountPercent: 25, requiresApproval: true, sortOrder: 4 },
  { name: 'open', displayName: 'Open', maxActiveAccounts: null, discountPercent: 5, requiresApproval: false, sortOrder: 5 },
];

resellerPlanSchema.statics.seedDefaults = async function () {
  const count = await this.countDocuments();
  if (count > 0) return;
  await this.insertMany(DEFAULT_PLANS);
};

export default mongoose.model('ResellerPlan', resellerPlanSchema);
