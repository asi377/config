import { Router } from 'express';
import { jwtAuth } from '../middlewares/jwtAuth.js';
import { requirePermission } from '../middlewares/rbac.js';
import AuditLogRepository from '../repositories/AuditLogRepository.js';
import * as AdminDashboardController from '../controllers/admin/AdminDashboardController.js';
import * as AdminUserController from '../controllers/admin/AdminUserController.js';
import * as AdminServerController from '../controllers/admin/AdminServerController.js';
import * as AdminPlanController from '../controllers/admin/AdminPlanController.js';
import * as AdminFinanceController from '../controllers/admin/AdminFinanceController.js';
import * as AdminBotController from '../controllers/admin/AdminBotController.js';
import * as AdminBandwidthController from '../controllers/admin/AdminBandwidthController.js';
import * as AdminLogController from '../controllers/admin/AdminLogController.js';
import * as AdminAnalyticsController from '../controllers/admin/AdminAnalyticsController.js';
import * as AdminTicketController from '../controllers/admin/AdminTicketController.js';
import * as AdminResellerController from '../controllers/admin/AdminResellerController.js';
import AdminSettingsService from '../services/admin/AdminSettingsService.js';
import BullMQManager from '../queue/bullmq.js';
import NodeManagerService from '../services/infra/NodeManagerService.js';

const router = Router();

// All routes require JWT auth
router.use(jwtAuth);

// ==================== DASHBOARD ====================
router.get('/dashboard', requirePermission('analytics.view'), AdminDashboardController.getDashboard);

// ==================== USERS ====================
router.get('/users', requirePermission('users.read'), async (req, res, next) => {
  try {
    const User = (await import('../models/User.js')).default;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const sortField = req.query.sort || 'createdAt';
    const sortOrder = req.query.order === 'asc' ? 1 : -1;

    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.search) {
      const s = req.query.search;
      filter.$or = [
        { telegramId: { $regex: s, $options: 'i' } },
        { referralCode: { $regex: s, $options: 'i' } },
        { firstName: { $regex: s, $options: 'i' } },
        { lastName: { $regex: s, $options: 'i' } },
        { username: { $regex: s, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).sort({ [sortField]: sortOrder }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true, data: { users, total, page, pages: Math.ceil(total / limit), limit },
    });
  } catch (err) { next(err); }
});

router.get('/users/search/:query', requirePermission('users.read'), AdminUserController.searchUsers);
router.get('/users/search', requirePermission('users.read'), AdminUserController.searchUsers);
router.get('/users/:id', requirePermission('users.read'), AdminUserController.getUser);
router.patch('/users/:id/role', requirePermission('users.write'), AdminUserController.updateUserRole);
router.post('/users/:id/ban', requirePermission('users.ban'), AdminUserController.banUser);
router.post('/users/:id/unban', requirePermission('users.ban'), async (req, res, next) => {
  try {
    const User = (await import('../models/User.js')).default;
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { role: 'user' } }, { new: true });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'user.unban', targetType: 'User', targetId: user._id,
    });
    res.json({ success: true, data: { telegramId: user.telegramId, role: user.role } });
  } catch (err) { next(err); }
});
router.post('/users/:id/reset-bandwidth', requirePermission('users.write'), AdminUserController.resetBandwidth);
router.post('/users/reset-free-trial', requirePermission('users.write'), AdminUserController.resetFreeTrialAll);
router.post('/users/:id/wallet', requirePermission('users.wallet'), async (req, res, next) => {
  try {
    const User = (await import('../models/User.js')).default;
    const Transaction = (await import('../models/Transaction.js')).default;
    const { amount, description } = req.body;
    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({ success: false, error: 'amount (number) is required' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const balanceBefore = user.walletBalance;
    user.walletBalance = Math.max(0, user.walletBalance + amount);
    await user.save();

    await Transaction.create({
      userId: user._id, type: 'admin_adjustment', amount,
      balanceBefore, balanceAfter: user.walletBalance,
      description: description || `Admin adjustment by ${req.admin.displayName || req.adminId}`,
      referenceType: 'admin', adminId: req.adminId,
    });

    await AuditLogRepository.create({
      adminId: req.adminId, action: 'user.wallet_adjust',
      targetType: 'User', targetId: user._id,
      oldValue: { walletBalance: balanceBefore },
      newValue: { walletBalance: user.walletBalance, amount },
    });

    res.json({ success: true, data: { telegramId: user.telegramId, walletBalance: user.walletBalance } });
  } catch (err) { next(err); }
});

// User transactions
router.get('/users/:id/transactions', requirePermission('payments.read'), async (req, res, next) => {
  try {
    const Transaction = (await import('../models/Transaction.js')).default;
    const txs = await Transaction.find({ userId: req.params.id })
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, data: txs });
  } catch (err) { next(err); }
});

// Full purchase history for a user: all subscriptions (incl. free trials) + receipts.
router.get('/users/:id/purchases', requirePermission('users.read'), async (req, res, next) => {
  try {
    const Subscription = (await import('../models/Subscription.js')).default;
    const Receipt = (await import('../models/Receipt.js')).default;
    const [subscriptions, receipts] = await Promise.all([
      Subscription.find({ ownerId: req.params.id })
        .populate('planId', 'title basePrice baseVolumeGB durationDays isTrial')
        .sort({ createdAt: -1 }).limit(100).lean(),
      Receipt.find({ userId: req.params.id })
        .populate('planId', 'title')
        .sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    res.json({ success: true, data: { subscriptions, receipts } });
  } catch (err) { next(err); }
});

// Quick action: manually activate a plan for a user (counts as revenue via an
// approved manual receipt). Optionally charge the user's wallet.
router.post('/users/:id/activate-plan', requirePermission('users.write'), async (req, res, next) => {
  try {
    const { planId, chargeWallet = false } = req.body;
    if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });

    const User = (await import('../models/User.js')).default;
    const Plan = (await import('../models/Plan.js')).default;
    const Receipt = (await import('../models/Receipt.js')).default;
    const subscriptionService = (await import('../services/SubscriptionService.js')).default;
    const ProvisioningService = (await import('../services/ProvisioningService.js')).default;
    const ConfigDeliveryService = (await import('../services/ConfigDeliveryService.js')).default;
    const { getPlanPrice } = await import('../utils/pricing.js');
    const { getBotInstance } = await import('../bot/botInstance.js');

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const priceToman = getPlanPrice(plan, 'fa').amount;

    // Provision without touching wallet (unless explicitly charging).
    let subscription = await subscriptionService.forceCreateSubscription(user.telegramId, planId);
    subscription = await subscriptionService.activateSubscription(subscription._id);
    if (chargeWallet && priceToman > 0) {
      user.walletBalance = Math.max(0, (user.walletBalance || 0) - priceToman);
      await user.save();
    }

    // Record an approved manual receipt so this manual sale shows up in revenue.
    const receipt = await Receipt.create({
      userId: user._id, planId, amount: priceToman, method: 'manual',
      status: 'approved', gateway: 'admin_manual', reviewedBy: req.adminId,
      subscriptionId: subscription._id, userClaimedPaid: true,
    });

    // Provision the tunnel + deliver configs to the user (best-effort).
    try {
      await ProvisioningService.provisionTunnelOnNode(subscription, plan, user);
      const bot = getBotInstance();
      if (bot) await ConfigDeliveryService.deliverForReceipt(bot.telegram, receipt._id, { requireClaim: false });
    } catch (err) {
      logger.warn?.({ err }, '[admin] manual activation provisioning/delivery failed');
    }

    await AuditLogRepository.create({
      adminId: req.adminId, action: 'user.manual_activate', targetType: 'User', targetId: user._id,
      newValue: { planId, priceToman, chargeWallet },
    });
    res.json({ success: true, data: { subscriptionId: subscription._id, receiptId: receipt._id } });
  } catch (err) { next(err); }
});

// Quick action: reactivate a user's free-trial eligibility (per user).
router.post('/users/:id/reactivate-trial', requirePermission('users.write'), async (req, res, next) => {
  try {
    const User = (await import('../models/User.js')).default;
    const user = await User.findByIdAndUpdate(
      req.params.id, { $set: { freeTrialClaimedAt: null } }, { new: true },
    );
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'user.reactivate_trial', targetType: 'User', targetId: user._id,
    });
    res.json({ success: true, data: { telegramId: user.telegramId, freeTrialClaimedAt: null } });
  } catch (err) { next(err); }
});

// ==================== SERVERS ====================
router.get('/servers', requirePermission('servers.read'), AdminServerController.getAllServers);
router.post('/servers', requirePermission('servers.write'), AdminServerController.addServer);
router.patch('/servers/:id', requirePermission('servers.write'), async (req, res, next) => {
  try {
    const Server = (await import('../models/Server.js')).default;
    const allowed = ['tags', 'isDedicated', 'dedicatedTo', 'region', 'salesEnabled', 'maxCapacity', 'port', 'name'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const server = await Server.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    res.json({ success: true, data: server });
  } catch (err) { next(err); }
});
router.patch('/servers/:id/sales', requirePermission('servers.manage'), AdminServerController.toggleServerSales);
router.post('/servers/:id/reboot', requirePermission('servers.manage'), AdminServerController.rebootServer);
router.delete('/servers/:id', requirePermission('servers.delete'), async (req, res, next) => {
  try {
    const Server = (await import('../models/Server.js')).default;
    const server = await Server.findByIdAndDelete(req.params.id);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'server.delete', targetType: 'Server', targetId: server._id,
      oldValue: { name: server.name },
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
});

// ==================== PLANS ====================
router.get('/plans', requirePermission('plans.read'), AdminPlanController.getAllPlans);
router.post('/plans', requirePermission('plans.write'), AdminPlanController.createPlan);
router.post('/plans/reorder', requirePermission('plans.write'), AdminPlanController.reorderPlans);
router.put('/plans/:id', requirePermission('plans.write'), AdminPlanController.updatePlan);
router.post('/plans/:id/clone', requirePermission('plans.write'), AdminPlanController.clonePlan);
router.delete('/plans/:id', requirePermission('plans.delete'), AdminPlanController.deletePlan);

// ==================== RESELLER PLANS & APPLICATIONS ====================
router.get('/reseller-plans', requirePermission('reseller.read'), AdminResellerController.getAllResellerPlans);
router.post('/reseller-plans', requirePermission('reseller.write'), AdminResellerController.createResellerPlan);
router.put('/reseller-plans/:id', requirePermission('reseller.write'), AdminResellerController.updateResellerPlan);
router.delete('/reseller-plans/:id', requirePermission('reseller.write'), AdminResellerController.deleteResellerPlan);

router.get('/reseller-applications', requirePermission('reseller.read'), AdminResellerController.getResellerApplications);
router.post('/reseller-applications/:userId/approve', requirePermission('reseller.write'), AdminResellerController.approveResellerApplication);
router.post('/reseller-applications/:userId/reject', requirePermission('reseller.write'), AdminResellerController.rejectResellerApplication);

// ==================== FINANCE ====================
router.get('/finance/daily', requirePermission('payments.read'), AdminFinanceController.getDailySales);
router.get('/finance/monthly/:year/:month', requirePermission('payments.read'), AdminFinanceController.getMonthlySales);
router.get('/finance/discounts', requirePermission('promo.read'), AdminFinanceController.getDiscountCodes);
router.get('/finance/projection', requirePermission('analytics.view'), AdminFinanceController.getRevenueProjection);

// ==================== BOT ====================
router.get('/bot/broadcast-targets', requirePermission('users.read'), AdminBotController.getBroadcastTargets);
router.post('/bot/broadcast', requirePermission('users.write'), AdminBotController.sendBroadcast);

// ==================== BOT CONFIG ====================
router.get('/bot-config', requirePermission('settings.read'), async (req, res, next) => {
  try {
    const BotConfig = (await import('../models/BotConfig.js')).default;
    const config = await BotConfig.getSingleton();
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
});

router.put('/bot-config', requirePermission('settings.write'), async (req, res, next) => {
  try {
    const BotConfig = (await import('../models/BotConfig.js')).default;
    const {
      welcomeText, smsBankRegex, cryptoPaymentEnabled, botMenus,
      deliveryTemplate, botCommands, botDescription, botShortDescription,
    } = req.body;
    const config = await BotConfig.getSingleton();
    // Localized fields are per-language objects ({ en, fa, ru }); merge partial
    // payloads so editing one language tab doesn't wipe the others.
    const mergeLocalized = (cur, next) => (typeof next === 'string'
      ? { ...cur?.toObject?.(), fa: next }
      : { ...cur?.toObject?.(), ...next });
    if (welcomeText !== undefined) config.welcomeText = mergeLocalized(config.welcomeText, welcomeText);
    if (deliveryTemplate !== undefined) config.deliveryTemplate = mergeLocalized(config.deliveryTemplate, deliveryTemplate);
    if (botDescription !== undefined) config.botDescription = mergeLocalized(config.botDescription, botDescription);
    if (botShortDescription !== undefined) config.botShortDescription = mergeLocalized(config.botShortDescription, botShortDescription);
    if (botCommands !== undefined) config.botCommands = botCommands;
    if (smsBankRegex !== undefined) config.smsBankRegex = smsBankRegex;
    if (cryptoPaymentEnabled !== undefined) config.cryptoPaymentEnabled = cryptoPaymentEnabled;
    if (botMenus !== undefined) config.botMenus = botMenus;
    await config.save();
    const AuditLogRepository = (await import('../repositories/AuditLogRepository.js')).default;
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'bot-config.update', targetType: 'BotConfig', targetId: config._id,
      newValue: { welcomeText, smsBankRegex, cryptoPaymentEnabled, botMenus: botMenus?.length },
    });
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
});

// ==================== FORCE-JOIN (mandatory channels) ====================
router.get('/force-join', requirePermission('settings.read'), async (req, res, next) => {
  try {
    const SettingRepository = (await import('../repositories/SettingRepository.js')).default;
    const enabled = await SettingRepository.get('forceSubscribe.enabled', false);
    const channels = await SettingRepository.get('forceSubscribe.channels', []);
    res.json({ success: true, data: { enabled, channels } });
  } catch (err) { next(err); }
});

router.put('/force-join', requirePermission('settings.write'), async (req, res, next) => {
  try {
    const SettingRepository = (await import('../repositories/SettingRepository.js')).default;
    const { enabled, channels } = req.body;
    if (enabled !== undefined) await SettingRepository.set('forceSubscribe.enabled', !!enabled);
    if (Array.isArray(channels)) {
      // Normalise: each channel needs an id; title/inviteLink optional.
      const clean = channels
        .filter((c) => c && c.id)
        .map((c) => ({ id: String(c.id).trim(), title: c.title || '', inviteLink: c.inviteLink || '' }));
      await SettingRepository.set('forceSubscribe.channels', clean);
    }
    const enabledNow = await SettingRepository.get('forceSubscribe.enabled', false);
    const channelsNow = await SettingRepository.get('forceSubscribe.channels', []);
    res.json({ success: true, data: { enabled: enabledNow, channels: channelsNow } });
  } catch (err) { next(err); }
});

// Apply the configured bot commands / description to Telegram (setMyCommands etc.)
router.post('/bot-commands/apply', requirePermission('settings.write'), async (req, res, next) => {
  try {
    const { applyBotCommands } = await import('../bot/applyBotCommands.js');
    const { getBotInstance } = await import('../bot/botInstance.js');
    const bot = getBotInstance();
    if (!bot) return res.status(503).json({ success: false, error: 'Bot not running' });
    const result = await applyBotCommands(bot);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ==================== CUSTOM BUTTONS (admin-defined content buttons) ====================
router.get('/custom-buttons', requirePermission('settings.read'), async (req, res, next) => {
  try {
    const BotConfig = (await import('../models/BotConfig.js')).default;
    const cfg = await BotConfig.getSingleton();
    res.json({ success: true, data: cfg.customButtons || [] });
  } catch (err) { next(err); }
});

router.put('/custom-buttons', requirePermission('settings.write'), async (req, res, next) => {
  try {
    const { customButtons } = req.body;
    if (!Array.isArray(customButtons)) {
      return res.status(400).json({ success: false, error: 'customButtons must be an array' });
    }
    const BotConfig = (await import('../models/BotConfig.js')).default;
    const cfg = await BotConfig.getSingleton();
    cfg.customButtons = customButtons;
    await cfg.save();
    // Drop the bot's 5s cache so the change shows up immediately.
    const { invalidateCustomButtonsCache } = await import('../bot/customButtons.js');
    invalidateCustomButtonsCache();
    const AuditLogRepository = (await import('../repositories/AuditLogRepository.js')).default;
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'custom-buttons.update', targetType: 'BotConfig', targetId: cfg._id,
      newValue: { count: customButtons.length },
    });
    res.json({ success: true, data: cfg.customButtons });
  } catch (err) { next(err); }
});

// ==================== SMS REGEX (auto card-to-card) ====================
// Build a proposed amount-capture regex from a sample bank SMS. The admin can
// optionally pin the real amount to disambiguate. Returns the regex + the
// detected amount so the panel can show a preview before saving.
router.post('/sms/build-regex', requirePermission('settings.write'), async (req, res, next) => {
  try {
    const { sample, amount } = req.body;
    if (!sample) return res.status(400).json({ success: false, error: 'sample is required' });
    const { buildRegexFromSample } = await import('../utils/smsRegexBuilder.js');
    const built = buildRegexFromSample(sample, amount != null && amount !== '' ? Number(amount) : null);
    if (!built) return res.status(422).json({ success: false, error: 'Could not detect an amount in the sample' });
    res.json({ success: true, data: built });
  } catch (err) { next(err); }
});

// Test mode: run a regex (the saved one, or one passed in) against a sample SMS
// and report what amount it extracts — mirrors production extraction exactly.
router.post('/sms/test', requirePermission('settings.read'), async (req, res, next) => {
  try {
    const { sample, regex } = req.body;
    if (!sample) return res.status(400).json({ success: false, error: 'sample is required' });
    const { testSmsRegex } = await import('../utils/smsRegexBuilder.js');
    let pattern = regex;
    if (!pattern) {
      const BotConfig = (await import('../models/BotConfig.js')).default;
      const cfg = await BotConfig.getSingleton();
      pattern = cfg?.smsBankRegex || '';
    }
    const extracted = testSmsRegex(pattern, sample);
    res.json({ success: true, data: { regex: pattern, extractedAmount: extracted, matched: extracted != null } });
  } catch (err) { next(err); }
});

// ==================== BANDWIDTH ====================
router.get('/bandwidth/scaling', requirePermission('servers.read'), AdminBandwidthController.getLoadScalingActions);

// ==================== LOGS ====================
router.get('/logs', requirePermission('audit.read'), AdminLogController.getAuditLogs);

// ==================== ANALYTICS ====================
router.get('/analytics/retention', requirePermission('analytics.view'), AdminAnalyticsController.getRetentionRate);
router.get('/analytics/churn', requirePermission('analytics.view'), AdminAnalyticsController.getChurnRate);
router.get('/analytics/server-popularity', requirePermission('analytics.view'), AdminAnalyticsController.getServerPopularity);

// ==================== TICKETS ====================
router.get('/tickets', requirePermission('tickets.read'), AdminTicketController.getAllTickets);
router.get('/tickets/:id', requirePermission('tickets.read'), AdminTicketController.getTicket);
router.post('/tickets/:id/reply', requirePermission('tickets.write'), AdminTicketController.replyToTicket);
router.post('/tickets/:id/close', requirePermission('tickets.close'), AdminTicketController.closeTicket);
router.post('/tickets/:id/reopen', requirePermission('tickets.close'), AdminTicketController.reopenTicket);

// ==================== PROMO CODES ====================
router.get('/promo-codes', requirePermission('promo.read'), async (req, res, next) => {
  try {
    const PromoCode = (await import('../models/PromoCode.js')).default;
    const codes = await PromoCode.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: codes });
  } catch (err) { next(err); }
});

router.post('/promo-codes', requirePermission('promo.write'), async (req, res, next) => {
  try {
    const PromoCode = (await import('../models/PromoCode.js')).default;
    const { code, discountPercent, maxDiscountAmount, expiresAt, usageLimit } = req.body;
    if (!code || !discountPercent) return res.status(400).json({ success: false, error: 'code and discountPercent are required' });
    const existing = await PromoCode.findOne({ code: code.toUpperCase() });
    if (existing) return res.status(409).json({ success: false, error: 'Promo code already exists' });
    const promo = await PromoCode.create({ code: code.toUpperCase(), discountPercent, maxDiscountAmount, expiresAt, usageLimit });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'promo.create', targetType: 'PromoCode', targetId: promo._id,
      newValue: { code: promo.code, discountPercent },
    });
    res.status(201).json({ success: true, data: promo });
  } catch (err) { next(err); }
});

router.put('/promo-codes/:id', requirePermission('promo.write'), async (req, res, next) => {
  try {
    const PromoCode = (await import('../models/PromoCode.js')).default;
    const promo = await PromoCode.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!promo) return res.status(404).json({ success: false, error: 'Promo code not found' });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'promo.update', targetType: 'PromoCode', targetId: promo._id,
      newValue: req.body,
    });
    res.json({ success: true, data: promo });
  } catch (err) { next(err); }
});

router.delete('/promo-codes/:id', requirePermission('promo.delete'), async (req, res, next) => {
  try {
    const PromoCode = (await import('../models/PromoCode.js')).default;
    const promo = await PromoCode.findByIdAndDelete(req.params.id);
    if (!promo) return res.status(404).json({ success: false, error: 'Promo code not found' });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'promo.delete', targetType: 'PromoCode', targetId: promo._id,
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
});

// ==================== SETTINGS ====================
router.get('/settings', requirePermission('settings.read'), async (req, res, next) => {
  try {
    const settings = await AdminSettingsService.listSettings(req.query);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

router.put('/settings/:key', requirePermission('settings.write'), async (req, res, next) => {
  try {
    const setting = await AdminSettingsService.updateSetting(req.params.key, req.body.value, req.adminId, req.ip);
    res.json({ success: true, data: setting });
  } catch (err) { next(err); }
});

// ==================== SUBSCRIPTIONS ====================
router.get('/subscriptions', requirePermission('subscriptions.read'), async (req, res, next) => {
  try {
    const Subscription = (await import('../models/Subscription.js')).default;
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.userId) filter.ownerId = req.query.userId;
    const subs = await Subscription.find(filter)
      .populate('ownerId', 'telegramId walletBalance')
      .populate('planId', 'title basePrice type')
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(req.query.limit) || 50, 200))
      .lean();
    res.json({ success: true, data: subs });
  } catch (err) { next(err); }
});

// ==================== RECEIPTS ====================
router.get('/receipts', requirePermission('payments.read'), async (req, res, next) => {
  try {
    const Receipt = (await import('../models/Receipt.js')).default;
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const receipts = await Receipt.find(filter)
      .populate('userId', 'telegramId')
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(req.query.limit) || 50, 200))
      .lean();
    res.json({ success: true, data: receipts });
  } catch (err) { next(err); }
});

router.get('/receipts/sms-matched', requirePermission('payments.read'), async (req, res, next) => {
  try {
    const Receipt = (await import('../models/Receipt.js')).default;
    const receipts = await Receipt.find({ status: 'sms_matched' })
      .sort({ smsMatchedAt: -1 })
      .populate('userId', 'telegramId');
    res.json({ success: true, data: receipts });
  } catch (err) { next(err); }
});

router.post('/receipts/:id/approve', requirePermission('payments.approve'), async (req, res, next) => {
  try {
    const PaymentService = (await import('../services/PaymentService.js')).default;
    const result = await PaymentService.processReceipt(req.params.id, req.adminId, 'approve');
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'receipt.approve', targetType: 'Receipt', targetId: result.receipt._id,
      newValue: { status: result.receipt.status },
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/receipts/:id/reject', requirePermission('payments.approve'), async (req, res, next) => {
  try {
    const PaymentService = (await import('../services/PaymentService.js')).default;
    const result = await PaymentService.processReceipt(req.params.id, req.adminId, 'reject');
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'receipt.reject', targetType: 'Receipt', targetId: result.receipt._id,
      newValue: { status: 'rejected' },
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ==================== FRAUD ====================
router.get('/fraud-logs', requirePermission('fraud.read'), async (req, res, next) => {
  try {
    const FraudLog = (await import('../models/FraudLog.js')).default;
    const filter = {};
    if (req.query.resolved !== undefined) filter.resolved = req.query.resolved === 'true';
    if (req.query.severity) filter.severity = req.query.severity;
    const logs = await FraudLog.find(filter)
      .populate('userId', 'telegramId')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, data: logs });
  } catch (err) { next(err); }
});

router.post('/fraud-logs/:id/resolve', requirePermission('fraud.resolve'), async (req, res, next) => {
  try {
    const FraudLog = (await import('../models/FraudLog.js')).default;
    const log = await FraudLog.findByIdAndUpdate(req.params.id, {
      $set: { resolved: true, resolvedBy: req.adminId, resolvedAt: new Date(), notes: req.body.notes || '' },
    }, { new: true });
    if (!log) return res.status(404).json({ success: false, error: 'Fraud log not found' });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'fraud.resolve', targetType: 'FraudLog', targetId: log._id,
    });
    res.json({ success: true, data: log });
  } catch (err) { next(err); }
});

// ==================== TRANSACTIONS ====================
router.get('/transactions', requirePermission('payments.read'), async (req, res, next) => {
  try {
    const Transaction = (await import('../models/Transaction.js')).default;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.userId) filter.userId = req.query.userId;
    const [txs, total] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('userId', 'telegramId')
        .populate('adminId', 'displayName email')
        .lean(),
      Transaction.countDocuments(filter),
    ]);
    res.json({ success: true, data: { transactions: txs, total, page, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

// ==================== QUEUE MANAGEMENT ====================
router.get('/queue/stats', requirePermission('servers.read'), async (req, res, next) => {
  try {
    const metrics = await BullMQManager.getAllMetrics();
    res.json({ success: true, data: metrics });
  } catch (err) { next(err); }
});

router.get('/queue/dlq/:queueName', requirePermission('servers.manage'), async (req, res, next) => {
  try {
    const jobs = await BullMQManager.getDeadLetterJobs(req.params.queueName, Math.min(parseInt(req.query.limit) || 20, 100));
    res.json({ success: true, data: jobs });
  } catch (err) { next(err); }
});

router.post('/queue/retry/:queueName/:jobId', requirePermission('servers.manage'), async (req, res, next) => {
  try {
    const result = await BullMQManager.retryDeadLetter(req.params.queueName, req.params.jobId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ==================== FRAUD MANAGEMENT ====================
router.get('/fraud/score/:userId', requirePermission('fraud.read'), async (req, res, next) => {
  try {
    const FraudScoreService = (await import('../services/FraudScoreService.js')).default;
    const profile = await FraudScoreService.getFraudProfile(req.params.userId);
    res.json({ success: true, data: profile });
  } catch (err) { next(err); }
});

router.post('/fraud/evaluate/:userId', requirePermission('fraud.resolve'), async (req, res, next) => {
  try {
    const FraudScoreService = (await import('../services/FraudScoreService.js')).default;
    const result = await FraudScoreService.evaluateUser(req.params.userId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ==================== NODE CREDENTIAL ROTATION ====================
router.post('/nodes/rotate-credentials/:serverId', requirePermission('servers.manage'), async (req, res, next) => {
  try {
    const result = await NodeManagerService.rotateNodeCredentials(req.params.serverId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/nodes/rotate-all-credentials', requirePermission('servers.manage'), async (req, res, next) => {
  try {
    const results = await NodeManagerService.rotateAllNodeCredentials();
    res.json({ success: true, data: { rotated: results.length, details: results } });
  } catch (err) { next(err); }
});

// ==================== REGION MANAGEMENT ====================
router.get('/regions/health', requirePermission('servers.read'), async (req, res, next) => {
  try {
    const LoadBalancerService = (await import('../services/infra/LoadBalancerService.js')).default;
    const health = await LoadBalancerService.checkAllRegions();
    res.json({ success: true, data: health });
  } catch (err) { next(err); }
});

export default router;
