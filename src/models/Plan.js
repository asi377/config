import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Plan title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    subtitle: {
      type: String,
      default: '',
      trim: true,
      maxlength: [180, 'Subtitle cannot exceed 180 characters'],
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    category: {
      type: String,
      default: 'عمومی',
      trim: true,
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Plan type is required'],
      enum: {
        values: ['economy', 'normal', 'vip', 'static_ip'],
        message: '{VALUE} is not a valid plan type',
      },
      index: true,
    },
    basePrice: {
      type: Number,
      required: [true, 'Base price is required'],
      min: [0, 'Price cannot be negative'],
    },
    baseVolumeGB: {
      type: Number,
      required: [true, 'Base volume is required'],
      min: [0, 'Volume cannot be negative'],
    },
    durationDays: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [1, 'Duration must be at least 1 day'],
    },
    maxSubLinks: {
      type: Number,
      required: [true, 'Max sub-links is required'],
      min: [1, 'Must allow at least 1 sub-link'],
      default: 1,
    },
    pricing: [{
      currency: {
        type: String,
        uppercase: true,
        trim: true,
        enum: ['IRR', 'IRT', 'USD', 'EUR', 'AED', 'TRY', 'USDT'],
      },
      amount: {
        type: Number,
        min: [0, 'Price cannot be negative'],
      },
      compareAtAmount: {
        type: Number,
        min: [0, 'Compare-at price cannot be negative'],
        default: null,
      },
      gateway: {
        type: String,
        trim: true,
        default: 'default',
      },
      enabled: {
        type: Boolean,
        default: true,
      },
    }],
    features: {
      type: [String],
      default: [],
    },
    allowedRegions: {
      type: [String],
      default: [],
      index: true,
    },
    allowedProtocols: {
      type: [String],
      default: ['vmess', 'vless', 'trojan'],
      enum: ['vmess', 'vless', 'trojan', 'shadowsocks'],
    },
    serverIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Server',
    }],
    sortOrder: {
      type: Number,
      default: 100,
      index: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'private', 'admin_only'],
      default: 'public',
      index: true,
    },
    salesEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    autoRenewEnabled: {
      type: Boolean,
      default: true,
    },
    purchaseLimitPerUser: {
      type: Number,
      default: null,
      min: [1, 'Purchase limit must be at least 1'],
    },
    renewalDiscountPercent: {
      type: Number,
      default: 0,
      min: [0, 'Renewal discount cannot be negative'],
      max: [100, 'Renewal discount cannot exceed 100'],
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    isTrial: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

planSchema.pre('validate', function () {
  if (!this.pricing || this.pricing.length === 0) {
    this.pricing = [{ currency: 'IRR', amount: this.basePrice, gateway: 'wallet', enabled: true }];
  }
});

planSchema.index({ type: 1, isActive: 1, isArchived: 1 });
planSchema.index({ isActive: 1, visibility: 1, sortOrder: 1 });
planSchema.index({ isActive: 1, salesEnabled: 1, basePrice: 1 });

export default mongoose.model('Plan', planSchema);
