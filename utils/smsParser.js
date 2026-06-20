const BANK_PATTERNS = [
  /انتقال:([\d,]+)\+/,
  /انتقالي:([\d,]+)\+/,
  /مبلغ:?\s*([\d,]+)\s*ریال/,
  /مبلغ:?\s*([\d,]+)/,
  /(\d{4,})\s*ریال/,
];

export function extractBankMelliAmount(smsText) {
  if (!smsText || typeof smsText !== 'string') return null;

  for (const pattern of BANK_PATTERNS) {
    const match = smsText.match(pattern);
    if (match) {
      const cleaned = match[1].replace(/,/g, '').trim();
      const amount = parseInt(cleaned, 10);
      if (!isNaN(amount) && amount > 0) {
        return amount;
      }
    }
  }
  return null;
}
