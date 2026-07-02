/**
 * ConfigDeliveryService
 *
 * Single place that delivers DIRECT configs (raw vless://… URIs) to users after
 * a successful payment / trial — instead of a bare /sub link. The delivery
 * message format is managed from the admin panel (BotConfig.deliveryTemplate,
 * localized) with a sensible localized default.
 *
 * Card-to-card is gated: delivery only happens after the user taps "I paid"
 * (receipt.userClaimedPaid) and the payment is approved, and is idempotent via
 * receipt.configDeliveredAt.
 */
import config from '../config/index.js';
import logger from '../config/logger.js';
import { t } from '../utils/i18n.js';
import { buildProxies } from './subscription/proxyBuilder.js';
import { buildShareLinks } from './subscription/linkGenerators.js';

const GB = 1073741824;

/** Raw config URIs (vless://…) for a tunnel UUID, or [] if none available. */
async function getDirectConfigLinks(uuid) {
  const { default: TunnelConfigRepository } = await import('../repositories/TunnelConfigRepository.js');
  const { default: ServerRepository } = await import('../repositories/ServerRepository.js');
  const tunnel = await TunnelConfigRepository.findByUuid(uuid);
  if (!tunnel || !tunnel.isActive) return [];
  const servers = await ServerRepository.findActive();
  const healthy = servers.filter((s) => s.healthStatus !== 'unhealthy' && s.status === 'active');
  if (!healthy.length) return [];
  return buildShareLinks(buildProxies(healthy, uuid));
}

/** Build the full delivery message (panel template if set, else localized default). */
async function buildMessage(uuid, { lang = 'fa', sub = null } = {}) {
  const links = await getDirectConfigLinks(uuid);
  const configsBlock = links.map((l) => `\`${l}\``).join('\n\n');
  const subLink = `${config.backendUrl}/sub/${uuid}`;
  const vars = {
    configs: configsBlock,
    link: subLink,
    volume: sub?.totalVolumeBytes > 0 ? `${Math.round(sub.totalVolumeBytes / GB)} GB` : '∞',
    days: sub?.expireDate ? Math.max(0, Math.ceil((new Date(sub.expireDate).getTime() - Date.now()) / 86400000)) : '',
  };

  let template = null;
  try {
    const { default: BotConfig } = await import('../models/BotConfig.js');
    const cfg = await BotConfig.getSingleton();
    template = cfg?.deliveryTemplate?.[lang] || cfg?.deliveryTemplate?.fa || null;
  } catch { /* fall back to default */ }

  if (template && template.trim()) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
  }
  return [
    t('config_delivery_header', lang),
    '',
    configsBlock || t('config_delivery_no_nodes', lang),
    '',
    t('config_delivery_footer', lang),
  ].join('\n');
}

/** Send direct configs for a specific tunnel UUID to a chat (used by wallet/trial). */
async function deliverByUuid(telegram, telegramId, uuid, { lang = 'fa', sub = null } = {}) {
  const msg = await buildMessage(uuid, { lang, sub });
  await telegram.sendMessage(telegramId, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
}

/**
 * Idempotent, gated delivery for a receipt. Sends configs only once, only if the
 * receipt is approved AND (for card receipts) the user has tapped "I paid".
 * @returns {Promise<boolean>} true if it delivered this call.
 */
async function deliverForReceipt(telegram, receiptOrId, { requireClaim = true } = {}) {
  const { default: Receipt } = await import('../models/Receipt.js');
  const { default: Subscription } = await import('../models/Subscription.js');
  const { default: TunnelConfig } = await import('../models/TunnelConfig.js');
  const { default: User } = await import('../models/User.js');

  const id = receiptOrId?._id || receiptOrId;
  const receipt = await Receipt.findById(id);
  if (!receipt) return false;
  if (receipt.configDeliveredAt) return false;                       // already delivered
  if (!['approved', 'auto_approved', 'paid'].includes(receipt.status)) return false;
  if (requireClaim && !receipt.userClaimedPaid) return false;        // card gate
  if (!receipt.subscriptionId) return false;                         // wallet top-up (no config)

  const tunnel = await TunnelConfig.findOne({ subscriptionId: receipt.subscriptionId, isActive: true }).sort({ createdAt: -1 });
  if (!tunnel) return false;

  const sub = await Subscription.findById(receipt.subscriptionId).lean();
  const user = await User.findById(receipt.userId).lean();
  if (!user?.telegramId) return false;
  const lang = user.language || 'fa';

  try {
    await deliverByUuid(telegram, user.telegramId, tunnel.uuid, { lang, sub });
    receipt.configDeliveredAt = new Date();
    await receipt.save();
    logger.info({ receiptId: receipt._id, uuid: tunnel.uuid }, '[delivery] direct configs sent');
    return true;
  } catch (err) {
    logger.error({ err, receiptId: receipt._id }, '[delivery] failed to send configs');
    return false;
  }
}

export default { getDirectConfigLinks, buildMessage, deliverByUuid, deliverForReceipt };
