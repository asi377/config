import 'dotenv/config';
import mongoose from 'mongoose';
import { Plan, Server } from './models/index.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vpn-panel';

const PLANS = [
  { title: 'Bronze',              type: 'economy',   basePrice: 1800000, baseVolumeGB: 20,  durationDays: 30,  maxSubLinks: 1, category: 'اشتراک ۱ ماهه', isActive: true },
  { title: 'Silver',              type: 'normal',    basePrice: 3400000, baseVolumeGB: 40,  durationDays: 60,  maxSubLinks: 1, category: 'اشتراک ۲ ماهه', isActive: true },
  { title: 'Gold',                type: 'normal',    basePrice: 4800000, baseVolumeGB: 60,  durationDays: 90,  maxSubLinks: 1, category: 'اشتراک ۳ ماهه', isActive: true },
  { title: 'VIP 20GB',            type: 'vip',       basePrice: 2200000, baseVolumeGB: 20,  durationDays: 30,  maxSubLinks: 2, category: 'اشتراک ۱ ماهه', isActive: true },
  { title: 'VIP 40GB',            type: 'vip',       basePrice: 4200000, baseVolumeGB: 40,  durationDays: 60,  maxSubLinks: 2, category: 'اشتراک ۲ ماهه', isActive: true },
  { title: 'VIP 60GB',            type: 'vip',       basePrice: 6000000, baseVolumeGB: 60,  durationDays: 90,  maxSubLinks: 2, category: 'اشتراک ۳ ماهه', isActive: true },
  { title: 'Family Pool 100GB',   type: 'vip',       basePrice: 8000000, baseVolumeGB: 100, durationDays: 30,  maxSubLinks: 5, category: 'سرویس‌های ویژه', isActive: true },
  { title: 'Emergency Pass 2GB',  type: 'economy',   basePrice: 300000,  baseVolumeGB: 2,   durationDays: 2,   maxSubLinks: 1, category: 'سرویس‌های ویژه', isActive: true },
  { title: 'Pay-As-You-Go 50GB',  type: 'normal',    basePrice: 7500000, baseVolumeGB: 50,  durationDays: 3650, maxSubLinks: 1, category: 'سرویس‌های ویژه', isActive: true },
  { title: 'Free Trial Plan 500MB', type: 'economy', basePrice: 0,      baseVolumeGB: 0.5, durationDays: 1,   maxSubLinks: 1, isTrial: true, category: 'آزمایشی', isActive: true },
];

const SERVERS = [
  { name: 'IRAN-1',  ipAddress: '5.5.5.5',   port: 443,   xrayApiPort: 8081, maxCapacity: 100, status: 'active' },
  { name: 'GERMANY-1', ipAddress: '5.5.5.6', port: 443,   xrayApiPort: 8082, maxCapacity: 200, status: 'active' },
  { name: 'NL-1',     ipAddress: '5.5.5.7',   port: 8443,  xrayApiPort: 8083, maxCapacity: 150, status: 'active' },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  // -- Plans (idempotent: upsert by title) --
  for (const plan of PLANS) {
    await Plan.findOneAndUpdate(
      { title: plan.title },
      { $set: plan },
      { upsert: true },
    );
  }
  console.log(`✓ Seeded ${PLANS.length} plans`);

  // -- Servers (idempotent: upsert by name) --
  for (const sv of SERVERS) {
    await Server.findOneAndUpdate(
      { name: sv.name },
      { $set: sv },
      { upsert: true },
    );
  }
  console.log(`✓ Seeded ${SERVERS.length} servers`);

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
