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

export function formatError(error) {
  if (error instanceof InsufficientQuotaError) return '⚠️ ظرفیت درخواستی بیش از حد مجاز است. مقدار کمتری انتخاب کنید.';
  if (error instanceof SubscriptionExpiredError) return '⏰ اشتراک شما منقضی شده است. لطفاً برای تمدید اقدام کنید.';
  if (error instanceof SubscriptionSuspendedError) return '🚫 اشتراک شما معلق شده است. با پشتیبانی تماس بگیرید.';
  if (error instanceof SubscriptionNotActiveError) return '❌ اشتراک فعالی ندارید. ابتدا یک طرح خریداری کنید.';
  if (error instanceof MaxSubLinksReachedError) return '🔒 حداکثر تعداد لینک‌های مجاز برای این طرح رسیده است.';
  if (error instanceof NotFoundError) return `❓ ${error.message} یافت نشد.`;
  if (error instanceof InsufficientBalanceError) return '💰 اعتبار کافی ندارید. لطفاً کیف پول خود را شارژ کنید.';
  if (error instanceof SharedPaymentNotPendingError) return '💳 این اشتراک در وضعیت پرداخت اشتراکی نیست.';
  return '❌ خطایی رخ داد. مجدداً تلاش کنید یا با پشتیبانی تماس بگیرید.';
}

export function formatRials(amount) {
  return `${amount.toLocaleString()} ریال`;
}

export function formatBytes(bytes) {
  const GB = 1073741824;
  if (bytes === null || bytes === undefined) return '♾️ نامحدود';
  const gb = bytes / GB;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(date) {
  if (!date) return '—';
  return date.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export const RANK_DATA = {
  egg:    { emoji: '🥚', label: 'تخم',      minSpent: 0 },
  worker: { emoji: '🐝', label: 'کارگر',    minSpent: 1 },
  hunter: { emoji: '⚔️', label: 'شکارچی',  minSpent: 1_000_000 },
  queen:  { emoji: '👑', label: 'ملکه',     minSpent: 5_000_000 },
};

export function calculateRank(totalSpent) {
  if (totalSpent >= 5_000_000) return 'queen';
  if (totalSpent >= 1_000_000) return 'hunter';
  if (totalSpent > 0) return 'worker';
  return 'egg';
}

export function formatRank(rank) {
  const r = RANK_DATA[rank];
  if (!r) return '🐝 کاربر';
  return `${r.emoji} ${r.label}`;
}
