/**
 * smsRegexBuilder.js
 *
 * Turns a *sample* bank SMS into a reusable regex that captures the payment
 * amount, so the admin doesn't have to hand-write regular expressions.
 *
 * The amount is the only thing we capture; everything else in a bank SMS
 * (date, time, tracking code, balance, card tail) varies between messages, so
 * we anchor the capture on the Persian keyword that sits next to the amount
 * (e.g. «مبلغ», «واریز», «ریال») rather than escaping the whole message — that
 * keeps the regex robust across messages with the same wording.
 *
 * Strategy ("guess + confirm"): we auto-detect the amount (optionally pinned by
 * a known amount the admin typed), propose a regex, and let the admin
 * edit/confirm it before saving.
 */

// Persian/Arabic-Indic digits → Latin.
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeDigits(str) {
  if (!str) return '';
  return String(str).replace(/[۰-۹٠-٩]/g, (d) => {
    let i = PERSIAN_DIGITS.indexOf(d);
    if (i === -1) i = ARABIC_DIGITS.indexOf(d);
    return i === -1 ? d : String(i);
  });
}

// Keywords that typically sit right next to the credited amount in Iranian
// bank SMS. Ordered by how strongly they imply "this is the amount".
const AMOUNT_KEYWORDS_BEFORE = ['مبلغ', 'واریز', 'بستانکار', 'انتقال', 'انتقالي'];
const AMOUNT_UNITS_AFTER = ['ریال', 'تومان', 'rial', 'irr'];
// Contexts whose adjacent number is NOT the amount (card/account/balance).
const NEGATIVE_BEFORE = ['کارت', 'حساب', 'شماره', 'موجودی', 'مانده', 'شبا', 'پیگیری', 'کد'];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the most likely "amount" number token in a sample SMS.
 * @param {string} sample
 * @param {number|null} knownAmount  if the admin typed the real amount, we pin to it
 * @returns {{ value:number, raw:string, index:number }|null}
 */
export function detectAmount(sample, knownAmount = null) {
  if (!sample) return null;
  const norm = normalizeDigits(sample);

  // All number tokens (allowing thousands separators), with positions.
  const tokens = [];
  const re = /[\d]{1,3}(?:[,،][\d]{3})+|[\d]{4,}/g; // grouped, or 4+ bare digits
  let m;
  while ((m = re.exec(norm)) !== null) {
    const raw = m[0];
    const value = parseInt(raw.replace(/[,،]/g, ''), 10);
    if (!Number.isNaN(value) && value > 0) {
      tokens.push({ value, raw, index: m.index });
    }
  }
  if (!tokens.length) return null;

  // 1) Pin to the admin-provided amount when given.
  if (knownAmount != null) {
    const pinned = tokens.find((t) => t.value === Number(knownAmount));
    if (pinned) return pinned;
  }

  // 2) Score every token by its surrounding context and pick the best.
  for (const tok of tokens) {
    const before = norm.slice(Math.max(0, tok.index - 12), tok.index);
    const after = norm.slice(tok.index + tok.raw.length, tok.index + tok.raw.length + 8).toLowerCase();
    let score = 0;
    if (AMOUNT_UNITS_AFTER.some((u) => after.includes(u))) score += 5;       // strongest: «... ریال»
    if (before.includes('مبلغ')) score += 4;                                 // «مبلغ ...»
    if (AMOUNT_KEYWORDS_BEFORE.slice(1).some((k) => before.includes(k))) score += 3; // واریز/بستانکار/...
    if (NEGATIVE_BEFORE.some((n) => before.includes(n))) score -= 6;          // card/account/balance/tracking
    if (/[,،]/.test(tok.raw)) score += 1;                                     // grouped numbers look like money
    tok.score = score;
  }
  const best = tokens.reduce((a, b) => (b.score > a.score ? b : a), tokens[0]);
  if (best.score > 0) return best;

  // 3) Fallback: the largest grouped number, else the largest number.
  const grouped = tokens.filter((t) => /[,،]/.test(t.raw));
  const pool = grouped.length ? grouped : tokens;
  return pool.reduce((a, b) => (b.value > a.value ? b : a), pool[0]);
}

/**
 * Builds a capture regex for the amount, anchored on its neighbouring keyword
 * or unit so it generalises to future messages.
 * @returns {{ regex:string, detectedAmount:number, anchor:string }|null}
 */
export function buildRegexFromSample(sample, knownAmount = null) {
  const norm = normalizeDigits(sample);
  const tok = detectAmount(norm, knownAmount);
  if (!tok) return null;

  // Number capture: digits with optional thousands separators.
  const NUM = '([\\d]{1,3}(?:[,،][\\d]{3})+|[\\d]{4,})';

  // Look for an immediate keyword before, then a unit after.
  const before = norm.slice(Math.max(0, tok.index - 16), tok.index);
  const after = norm.slice(tok.index + tok.raw.length, tok.index + tok.raw.length + 10);

  const kw = AMOUNT_KEYWORDS_BEFORE.find((k) => before.includes(k));
  if (kw) {
    // keyword ... amount   →  keyword<sep>amount
    return { regex: `${escapeRegex(kw)}\\s*[:\\-]?\\s*${NUM}`, detectedAmount: tok.value, anchor: kw };
  }

  const unit = AMOUNT_UNITS_AFTER.find((u) => after.toLowerCase().includes(u));
  if (unit) {
    // amount unit   →  amount<sep>unit
    return { regex: `${NUM}\\s*${escapeRegex(unit)}`, detectedAmount: tok.value, anchor: unit };
  }

  // No anchor — fall back to a bare grouped-number capture.
  return { regex: NUM, detectedAmount: tok.value, anchor: '' };
}

/**
 * Runs a (saved) regex against an SMS and returns the extracted integer amount,
 * or null. Mirrors the matcher in smsParser so the test mode and production use
 * identical logic.
 */
export function testSmsRegex(regexString, sample) {
  if (!regexString || !sample) return null;
  try {
    const norm = normalizeDigits(sample);
    const match = norm.match(new RegExp(regexString));
    if (match && match[1]) {
      const amount = parseInt(match[1].replace(/[,،]/g, '').trim(), 10);
      if (!Number.isNaN(amount) && amount > 0) return amount;
    }
  } catch {
    return null; // invalid regex
  }
  return null;
}
