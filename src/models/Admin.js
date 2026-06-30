import mongoose from 'mongoose';
import config from '../config/index.js';
import logger from '../config/logger.js';

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  displayName: String,
  passwordHash: { type: String, required: true },
  telegramId: String,
  role: { type: String, enum: ['superadmin', 'finance', 'support', 'ops', 'analyst', 'marketer'], default: 'support' },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: String,
  permissions: [String],
  active: { type: Boolean, default: true },
  lastLogin: Date,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Admin', adminSchema);
