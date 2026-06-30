#!/usr/bin/env node
import 'dotenv/config';
import mongoose from 'mongoose';
import config from './src/config/index.js';
import logger from './src/config/logger.js';

const Admin = (await import('./src/models/Admin.js')).default;
const Plan = (await import('./src/models/Plan.js')).default;
const User = (await import('./src/models/User.js')).default;

async function seed() {
  try {
    await mongoose.connect(config.mongoUri);
    logger.info('Connected to MongoDB');

    // Clear existing data
    await Admin.deleteMany({});
    await Plan.deleteMany({});
    await User.deleteMany({});

    // Create superadmin (password is hashed by the Admin model's pre-save hook)
    const admin = await Admin.create({
      email: 'admin@hornet.local',
      displayName: 'System Admin',
      password: 'admin123456',
      role: 'superadmin',
    });
    logger.info({ adminId: admin._id }, '[seed] Superadmin created');

    // Create sample plans
    const plans = await Plan.create([
      {
        title: 'Starter',
        basePrice: 50000,
        baseVolumeGB: 10,
        durationDays: 30,
        type: 'economy',
        maxSubLinks: 2,
        pricing: [{ currency: 'IRR', amount: 50000, enabled: true }],
      },
      {
        title: 'Pro',
        basePrice: 150000,
        baseVolumeGB: 50,
        durationDays: 30,
        type: 'normal',
        maxSubLinks: 5,
        pricing: [{ currency: 'IRR', amount: 150000, enabled: true }],
      },
    ]);
    logger.info({ count: plans.length }, '[seed] Plans created');

    // Create sample users
    const users = await User.create([
      { telegramId: '123456789', walletBalance: 100000 },
      { telegramId: '987654321', walletBalance: 50000 },
    ]);
    logger.info({ count: users.length }, '[seed] Users created');

    logger.info('[seed] Database seeding completed');
    await mongoose.disconnect();
  } catch (err) {
    logger.error({ err }, '[seed] Error');
    process.exit(1);
  }
}

seed();
