export function formatRials(amount) {
  return `${amount.toLocaleString()} ریال`;
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

export function formatBytes(bytes) {
  const GB = 1073741824;
  if (bytes === null || bytes === undefined) return '♾️ نامحدود';
  const gb = bytes / GB;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(date) {
  if (!date) return '—';
  return date.toLocaleDateString('fa-IR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}
