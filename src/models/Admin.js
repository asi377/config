import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  displayName: String,
  password: { type: String, required: true },
  telegramId: String,
  role: { type: String, enum: ['superadmin', 'finance', 'support', 'ops', 'analyst', 'marketer'], default: 'support' },
  permissions: [String],
  totpSecret: String,
  totpEnabled: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: Date,
  lastLoginIp: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
}, { timestamps: true });

adminSchema.pre('save', async function preSave() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

adminSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

adminSchema.methods.isLocked = function isLocked() {
  return !!(this.lockedUntil && this.lockedUntil > new Date());
};

adminSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.password;
    delete ret.totpSecret;
    return ret;
  },
});

export default mongoose.model('Admin', adminSchema);
