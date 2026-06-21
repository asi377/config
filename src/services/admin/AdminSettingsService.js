import BaseService from '../../shared/BaseService.js';
import { ValidationError } from '../../shared/errors.js';
import SettingRepository from '../../repositories/SettingRepository.js';
import AuditLogRepository from '../../repositories/AuditLogRepository.js';

const SETTING_CATALOG = [
  { key: 'brandName', group: 'brand', label: 'Brand name', type: 'string', value: 'HORNET', sortOrder: 10, isPublic: true },
  { key: 'supportContact', group: 'brand', label: 'Support contact', type: 'string', value: '@admin', sortOrder: 20, isPublic: true },
  { key: 'maintenanceMode', group: 'operations', label: 'Maintenance mode', type: 'boolean', value: false, sortOrder: 10, isPublic: true },
  { key: 'maintenanceMessage', group: 'operations', label: 'Maintenance message', type: 'text', value: 'سرویس در حال بروزرسانی است.', sortOrder: 20, isPublic: true },
  { key: 'cardNumber', group: 'payments', label: 'Card number', type: 'string', value: '5022-2910-XXXX-XXXX', sortOrder: 10 },
  { key: 'minWalletCharge', group: 'payments', label: 'Minimum wallet charge', type: 'number', value: 100000, sortOrder: 20 },
  { key: 'defaultCurrency', group: 'payments', label: 'Default currency', type: 'string', value: 'IRR', sortOrder: 30, isPublic: true },
  { key: 'usdRateIRR', group: 'payments', label: 'USD to IRR rate', type: 'number', value: 0, sortOrder: 40 },
  { key: 'trialEnabled', group: 'sales', label: 'Trial enabled', type: 'boolean', value: true, sortOrder: 10, isPublic: true },
  { key: 'referralBonusPercent', group: 'sales', label: 'Referral bonus percent', type: 'number', value: 10, sortOrder: 20 },
  { key: 'purchaseSuccessText', group: 'bot_texts', label: 'Purchase success text', type: 'text', value: 'خرید شما با موفقیت انجام شد.', sortOrder: 10, isPublic: true },
  { key: 'paymentInstructionsIRR', group: 'bot_texts', label: 'IRR payment instructions', type: 'text', value: 'مبلغ را کارت به کارت کنید و رسید را ارسال کنید.', sortOrder: 20, isPublic: true },
  { key: 'paymentInstructionsUSD', group: 'bot_texts', label: 'USD payment instructions', type: 'text', value: 'International payment instructions will be shown here.', sortOrder: 30, isPublic: true },
  { key: 'serverSalesPolicy', group: 'servers', label: 'Server sales policy', type: 'json', value: { preferHealthy: true, maxLoadPercent: 80 }, sortOrder: 10 },
];

function catalogByKey(key) {
  return SETTING_CATALOG.find(item => item.key === key);
}

function coerceValue(rawValue, type) {
  if (type === 'number') {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new ValidationError('Setting value must be a valid number');
    return value;
  }
  if (type === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue;
    if (rawValue === 'true') return true;
    if (rawValue === 'false') return false;
    throw new ValidationError('Setting value must be true or false');
  }
  if (type === 'json') {
    if (typeof rawValue === 'object' && rawValue !== null) return rawValue;
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new ValidationError('Setting value must be valid JSON');
    }
  }
  return String(rawValue ?? '');
}

class AdminSettingsService extends BaseService {
  ensureDefaults = this.wrapMethod(async () => {
    const ensured = [];
    for (const item of SETTING_CATALOG) {
      const existing = await SettingRepository.findOne({ key: item.key });
      if (!existing) {
        ensured.push(await SettingRepository.set(item.key, item.value, {
          group: item.group,
          label: item.label,
          type: item.type,
          description: item.description || '',
          isPublic: !!item.isPublic,
          isSecret: !!item.isSecret,
          editable: item.editable !== false,
          sortOrder: item.sortOrder || 100,
        }));
      }
    }
    return ensured;
  });

  listSettings = this.wrapMethod(async ({ group } = {}) => {
    await this.ensureDefaults();
    const filter = group ? { group } : {};
    return SettingRepository.findMany(filter, { sort: { group: 1, sortOrder: 1, key: 1 } });
  });

  updateSetting = this.wrapMethod(async (key, rawValue, adminId, ip) => {
    const existing = await SettingRepository.findOne({ key });
    const catalog = catalogByKey(key);
    const type = existing?.type || catalog?.type || 'string';

    if (existing && existing.editable === false) {
      throw new ValidationError('This setting is not editable');
    }

    const value = coerceValue(rawValue, type);
    const meta = catalog
      ? {
        group: existing?.group || catalog.group,
        label: existing?.label || catalog.label,
        type,
        description: existing?.description || catalog.description || '',
        isPublic: existing?.isPublic ?? !!catalog.isPublic,
        isSecret: existing?.isSecret ?? !!catalog.isSecret,
        editable: existing?.editable ?? catalog.editable !== false,
        sortOrder: existing?.sortOrder || catalog.sortOrder || 100,
      }
      : { type };

    const setting = await SettingRepository.set(key, value, meta);
    await AuditLogRepository.createLog(adminId, 'setting.update', 'Setting', setting._id, existing, { key, value }, ip);
    return setting;
  });
}

export default new AdminSettingsService();
