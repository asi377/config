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
