import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const adminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
    },
    displayName: {
      type: String,
      required: [true, 'Display name is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: {
        values: ['superadmin', 'admin', 'support', 'finance', 'analyst', 'moderator'],
        message: '{VALUE} is not a valid admin role',
      },
      default: 'admin',
      index: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
    totpSecret: {
      type: String,
      default: null,
    },
    totpEnabled: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastLoginIp: {
      type: String,
      default: null,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.totpSecret;
        delete ret.__v;
        return ret;
      },
    },
  }
);

adminSchema.index({ role: 1, isActive: 1 });

adminSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

adminSchema.methods.isLocked = function () {
  return this.lockedUntil && this.lockedUntil > new Date();
};

export default mongoose.model('Admin', adminSchema);
