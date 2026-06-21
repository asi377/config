import BaseService from '../../shared/BaseService.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import PlanRepository from '../../repositories/PlanRepository.js';
import AuditLogRepository from '../../repositories/AuditLogRepository.js';

const PLAN_TYPES = ['economy', 'normal', 'vip', 'static_ip'];
const VISIBILITY = ['public', 'private', 'admin_only'];
const PROTOCOLS = ['vmess', 'vless', 'trojan', 'shadowsocks'];
const CURRENCIES = ['IRR', 'IRT', 'USD', 'EUR', 'AED', 'TRY', 'USDT'];

function toNumber(value, field, { min = null, max = null, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ValidationError(`${field} must be a valid number`);
  if (min !== null && number < min) throw new ValidationError(`${field} must be at least ${min}`);
  if (max !== null && number > max) throw new ValidationError(`${field} must be at most ${max}`);
  return number;
}

function toBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return Boolean(value);
}

function toStringList(value, field, allowed = null) {
  if (value === undefined || value === null || value === '') return undefined;
  const list = Array.isArray(value)
    ? value
    : String(value).split(',').map(item => item.trim());
  const normalized = [...new Set(list.map(item => String(item).trim()).filter(Boolean))];
  if (allowed) {
    const invalid = normalized.find(item => !allowed.includes(item));
    if (invalid) throw new ValidationError(`${field} contains invalid value: ${invalid}`);
  }
  return normalized;
}

function normalizePricing(input, basePrice) {
  if (input === undefined) return undefined;
  const pricing = Array.isArray(input) ? input : [];
  const normalized = pricing
    .map(item => ({
      currency: String(item.currency || '').toUpperCase(),
      amount: toNumber(item.amount, 'pricing.amount', { min: 0, required: true }),
      compareAtAmount: toNumber(item.compareAtAmount, 'pricing.compareAtAmount', { min: 0 }),
      gateway: item.gateway ? String(item.gateway).trim() : 'default',
      enabled: item.enabled !== false,
    }))
    .filter(item => item.currency && CURRENCIES.includes(item.currency));

  if (normalized.length === 0 && basePrice !== undefined) {
    normalized.push({ currency: 'IRR', amount: basePrice, gateway: 'wallet', enabled: true });
  }

  return normalized;
}

function sanitizePlanPayload(data, { partial = false } = {}) {
  const payload = {};

  if (!partial || data.title !== undefined) {
    if (!data.title || !String(data.title).trim()) throw new ValidationError('title is required');
    payload.title = String(data.title).trim();
  }
  if (data.subtitle !== undefined) payload.subtitle = String(data.subtitle || '').trim();
  if (data.description !== undefined) payload.description = String(data.description || '').trim();
  if (data.category !== undefined) payload.category = String(data.category || 'عمومی').trim();

  if (!partial || data.type !== undefined) {
    if (!PLAN_TYPES.includes(data.type)) throw new ValidationError('Invalid plan type');
    payload.type = data.type;
  }

  const basePrice = toNumber(data.basePrice, 'basePrice', { min: 0, required: !partial });
  if (basePrice !== undefined) payload.basePrice = basePrice;

  const baseVolumeGB = toNumber(data.baseVolumeGB, 'baseVolumeGB', { min: 0, required: !partial });
  if (baseVolumeGB !== undefined) payload.baseVolumeGB = baseVolumeGB;

  const durationDays = toNumber(data.durationDays, 'durationDays', { min: 1, required: !partial });
  if (durationDays !== undefined) payload.durationDays = durationDays;

  const maxSubLinks = toNumber(data.maxSubLinks, 'maxSubLinks', { min: 1 });
  if (maxSubLinks !== undefined) payload.maxSubLinks = maxSubLinks;

  const sortOrder = toNumber(data.sortOrder, 'sortOrder', { min: 0 });
  if (sortOrder !== undefined) payload.sortOrder = sortOrder;

  const purchaseLimitPerUser = toNumber(data.purchaseLimitPerUser, 'purchaseLimitPerUser', { min: 1 });
  if (purchaseLimitPerUser !== undefined) payload.purchaseLimitPerUser = purchaseLimitPerUser;
  if (data.purchaseLimitPerUser === null || data.purchaseLimitPerUser === '') payload.purchaseLimitPerUser = null;

  const renewalDiscountPercent = toNumber(data.renewalDiscountPercent, 'renewalDiscountPercent', { min: 0, max: 100 });
  if (renewalDiscountPercent !== undefined) payload.renewalDiscountPercent = renewalDiscountPercent;

  if (data.visibility !== undefined) {
    if (!VISIBILITY.includes(data.visibility)) throw new ValidationError('Invalid visibility');
    payload.visibility = data.visibility;
  }

  const pricing = normalizePricing(data.pricing, payload.basePrice);
  if (pricing !== undefined) payload.pricing = pricing;

  const features = toStringList(data.features, 'features');
  if (features !== undefined) payload.features = features;

  const allowedRegions = toStringList(data.allowedRegions, 'allowedRegions');
  if (allowedRegions !== undefined) payload.allowedRegions = allowedRegions;

  const allowedProtocols = toStringList(data.allowedProtocols, 'allowedProtocols', PROTOCOLS);
  if (allowedProtocols !== undefined) payload.allowedProtocols = allowedProtocols;

  const tags = toStringList(data.tags, 'tags');
  if (tags !== undefined) payload.tags = tags;

  const serverIds = toStringList(data.serverIds, 'serverIds');
  if (serverIds !== undefined) payload.serverIds = serverIds;

  for (const key of ['isTrial', 'isActive', 'salesEnabled', 'autoRenewEnabled', 'isArchived']) {
    const value = toBoolean(data[key]);
    if (value !== undefined) payload[key] = value;
  }

  return payload;
}

class AdminPlanService extends BaseService {
  getAllPlans = this.wrapMethod(async (filters = {}) => {
    const query = {};
    if (filters.includeArchived !== 'true') query.isArchived = { $ne: true };
    if (filters.status === 'active') query.isActive = true;
    if (filters.status === 'inactive') query.isActive = false;
    if (filters.sales === 'enabled') query.salesEnabled = true;
    if (filters.sales === 'disabled') query.salesEnabled = false;
    if (filters.type) query.type = filters.type;
    if (filters.category) query.category = filters.category;
    if (filters.visibility) query.visibility = filters.visibility;
    return PlanRepository.findMany(query, { sort: { sortOrder: 1, basePrice: 1 } });
  });

  createPlan = this.wrapMethod(async (data, adminId, ip) => {
    const payload = sanitizePlanPayload(data);
    const plan = await PlanRepository.create(payload);
    await AuditLogRepository.createLog(adminId, 'create_plan', 'plan', plan._id, null, payload, ip);
    return plan;
  });

  updatePlan = this.wrapMethod(async (planId, updates, adminId, ip) => {
    const old = await PlanRepository.findById(planId);
    if (!old) throw new NotFoundError('Plan');
    const payload = sanitizePlanPayload(updates, { partial: true });
    const plan = await PlanRepository.updateById(planId, { $set: payload });
    await AuditLogRepository.createLog(adminId, 'update_plan', 'plan', planId, old, payload, ip);
    return plan;
  });

  deletePlan = this.wrapMethod(async (planId, adminId, ip) => {
    const old = await PlanRepository.findById(planId);
    if (!old) throw new NotFoundError('Plan');
    const plan = await PlanRepository.updateById(planId, { $set: { isArchived: true, isActive: false, salesEnabled: false } });
    await AuditLogRepository.createLog(adminId, 'archive_plan', 'plan', planId, old, { isArchived: true }, ip);
    return { archived: true, plan };
  });

  clonePlan = this.wrapMethod(async (planId, adminId, ip) => {
    const old = await PlanRepository.findById(planId);
    if (!old) throw new NotFoundError('Plan');
    const source = old.toObject();
    delete source._id;
    delete source.createdAt;
    delete source.updatedAt;
    delete source.__v;
    source.title = `${source.title} Copy`;
    source.isActive = false;
    source.salesEnabled = false;
    source.sortOrder = (source.sortOrder || 100) + 1;
    const plan = await PlanRepository.create(source);
    await AuditLogRepository.createLog(adminId, 'clone_plan', 'plan', plan._id, old, plan, ip);
    return plan;
  });

  reorderPlans = this.wrapMethod(async (items, adminId, ip) => {
    if (!Array.isArray(items)) throw new ValidationError('items must be an array');
    const updates = [];
    for (const item of items) {
      if (!item.id) throw new ValidationError('Each item must include id');
      const sortOrder = toNumber(item.sortOrder, 'sortOrder', { min: 0, required: true });
      updates.push(PlanRepository.updateById(item.id, { $set: { sortOrder } }));
    }
    await Promise.all(updates);
    await AuditLogRepository.createLog(adminId, 'reorder_plans', 'plan', null, null, { items }, ip);
    return { updated: updates.length };
  });
}

export default new AdminPlanService();
