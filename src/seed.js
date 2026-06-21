import mongoose from 'mongoose';
import config from './config/index.js';
import logger from './config/logger.js';
import Plan from './models/Plan.js';
import Admin from './models/Admin.js';
import AdminSettingsService from './services/admin/AdminSettingsService.js';

async function seed() {
  await mongoose.connect(config.mongoUri);
  logger.info('Connected to MongoDB for seeding');

  // Seed default settings
  await AdminSettingsService.ensureDefaults();
  logger.info('Default settings ensured');

  const defaultAdminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@hornet.com';
  const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123456';
  const defaultAdminName = process.env.DEFAULT_ADMIN_NAME || 'مدیر سیستم';

  if (config.env === 'production' && defaultAdminPassword === 'admin123456') {
    throw new Error('DEFAULT_ADMIN_PASSWORD must be set to a strong value before seeding production');
  }

  // Seed default admin
  const existingAdmin = await Admin.findOne({ email: defaultAdminEmail });
  if (!existingAdmin) {
    await Admin.create({
      email: defaultAdminEmail,
      password: defaultAdminPassword,
      displayName: defaultAdminName,
      role: 'superadmin',
    });
    logger.info({ email: defaultAdminEmail }, 'Default superadmin created');
  } else {
    logger.info('Default admin already exists, skipping');
  }

  // Seed default plans
  const existingPlans = await Plan.countDocuments();
  if (existingPlans === 0) {
    await Plan.create([
      { title: 'پایه', subtitle: 'مناسب مصرف سبک', category: 'عمومی', type: 'economy', basePrice: 100000, baseVolumeGB: 10, durationDays: 30, maxSubLinks: 2, sortOrder: 10, features: ['اقتصادی', 'تمدید خودکار'], pricing: [{ currency: 'IRR', amount: 100000, gateway: 'wallet' }, { currency: 'USD', amount: 2, gateway: 'stripe', enabled: false }] },
      { title: 'پیشرفته', subtitle: 'انتخاب متعادل', category: 'عمومی', type: 'normal', basePrice: 250000, baseVolumeGB: 30, durationDays: 30, maxSubLinks: 5, sortOrder: 20, features: ['سرعت بهتر', 'چند لینک'], pricing: [{ currency: 'IRR', amount: 250000, gateway: 'wallet' }, { currency: 'USD', amount: 5, gateway: 'stripe', enabled: false }] },
      { title: 'حرفه‌ای', subtitle: 'برای مصرف سنگین', category: 'عمومی', type: 'vip', basePrice: 500000, baseVolumeGB: 80, durationDays: 30, maxSubLinks: 10, sortOrder: 30, features: ['اولویت سرور', 'حجم بالا'], pricing: [{ currency: 'IRR', amount: 500000, gateway: 'wallet' }, { currency: 'USD', amount: 10, gateway: 'stripe', enabled: false }] },
      { title: 'آزمایشی', subtitle: 'برای تست سرویس', category: 'آزمایشی', type: 'economy', basePrice: 0, baseVolumeGB: 0.5, durationDays: 1, maxSubLinks: 1, isTrial: true, sortOrder: 1, purchaseLimitPerUser: 1, features: ['یک‌بار برای هر کاربر'] },
    ]);
    logger.info('Default plans created');
  } else {
    logger.info({ count: existingPlans }, 'Plans already exist, skipping');
  }

  await mongoose.disconnect();
  logger.info('Seed complete');
  process.exit(0);
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
