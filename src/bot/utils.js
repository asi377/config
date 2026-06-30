import {
  NotFoundError,
  InsufficientQuotaError,
  InsufficientBalanceError,
  SubscriptionExpiredError,
  SubscriptionSuspendedError,
  SubscriptionNotActiveError,
  MaxSubLinksReachedError,
  SharedPaymentNotPendingError,
} from '../shared/errors.js';
import { t } from '../utils/i18n.js';

export {
  formatRials,
  formatBytes,
  formatDate,
  formatRank,
  calculateRank,
  RANK_DATA,
} from '../utils/formatters.js';

export function formatError(error, lang = 'fa') {
  if (error instanceof InsufficientQuotaError) return t('error_insufficient_quota', lang);
  if (error instanceof SubscriptionExpiredError) return t('error_subscription_expired', lang);
  if (error instanceof SubscriptionSuspendedError) return t('error_subscription_suspended', lang);
  if (error instanceof SubscriptionNotActiveError) return t('error_subscription_not_active', lang);
  if (error instanceof MaxSubLinksReachedError) return t('error_max_sublinks_reached', lang);
  if (error instanceof NotFoundError) return t('error_not_found', lang, { resource: error.message });
  if (error instanceof InsufficientBalanceError) return t('error_insufficient_balance', lang);
  if (error instanceof SharedPaymentNotPendingError) return t('error_shared_payment_not_pending', lang);
  return t('error_unknown', lang);
}
