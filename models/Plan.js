import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Plan title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
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
    isTrial: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

planSchema.index({ type: 1, isActive: 1 });
planSchema.index({ isActive: 1, basePrice: 1 });

export default mongoose.model('Plan', planSchema);
