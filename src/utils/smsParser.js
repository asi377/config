import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import BotConfig from '../models/BotConfig.js';

/**
 * Normalise a Persian/Arabic string for robust matching:
 *  - Arabic yeh (ي U+064A) → Persian yeh (ی U+06CC)
 *  - Arabic kaf (ك U+0643) → Persian kaf (ک U+06A9)
 *  - Persian/Arabic-Indic digits → Latin digits
 */
function normalizeFa(input) {
  const s = String(input);
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return s
    .replace(/[۰-۹]/g, (d) => String(persianDigits.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک');
}

/**
 * STRICT Bank-Melli transfer-SMS parser.
 *
 * Only accepts the official Bank-Melli card-transfer format, e.g.:
 *   بانك ملي ايران
 *   كارت: 0597
 *   انتقال: 650,000
 *   مانده: 957,732
 *   تاريخ: 1405/04/10
 *   ساعت: 15:01:50
 *
 * Any SMS that is not a Bank-Melli transfer (missing the bank header or the
 * `انتقال` transfer line) is rejected → returns null. Loose `مبلغ`/deposit
 * formats are intentionally NOT accepted.
 *
 * @returns {{ amount:number, card:string|null, date:string|null, time:string|null }|null}
 */
export function parseBankMelliSms(smsText) {
  if (!smsText || typeof smsText !== 'string') return null;
  const text = normalizeFa(smsText);

  // Require the bank identity AND a transfer line to accept the SMS.
  const hasBankHeader = /بانک\s*ملی\s*ایران/.test(text);
  const transferMatch = text.match(/انتقال\s*[:：]?\s*([\d,]+)/);
  if (!hasBankHeader || !transferMatch) return null;

  const amount = parseInt(transferMatch[1].replace(/,/g, ''), 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const cardMatch = text.match(/کارت\s*[:：]?\s*(\d{3,4})/);
  const dateMatch = text.match(/تاریخ\s*[:：]?\s*(\d{4}\/\d{1,2}\/\d{1,2})/);
  const timeMatch = text.match(/ساعت\s*[:：]?\s*(\d{1,2}:\d{2}:\d{2})/);

  return {
    amount,
    card: cardMatch ? cardMatch[1] : null,
    date: dateMatch ? dateMatch[1] : null,
    time: timeMatch ? timeMatch[1] : null,
  };
}

/**
 * Backward-compatible amount extractor — now backed by the strict parser, so it
 * only returns an amount for a genuine Bank-Melli transfer SMS.
 */
export function extractBankMelliAmount(smsText) {
  const parsed = parseBankMelliSms(smsText);
  return parsed ? parsed.amount : null;
}

function extractAmountWithRegex(smsText, regexString) {
  if (!smsText || typeof smsText !== 'string' || !regexString) return null;
  try {
    const regex = new RegExp(regexString);
    const match = smsText.match(regex);
    if (match && match[1]) {
      const cleaned = match[1].replace(/,/g, '').trim();
      const amount = parseInt(cleaned, 10);
      if (!isNaN(amount) && amount > 0) return amount;
    }
  } catch {
    // Invalid regex, fall back to default patterns
  }
  return null;
}

export const handleSmsWebhook = async (req, res) => {
  try {
    const smsText = req.body?.message || req.body?.text || req.body?.body || '';
    const userId = req.body?.userId;
    if (!smsText) {
      return res.status(400).json({ success: false, error: 'Missing SMS text in request body' });
    }
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const botConfig = await BotConfig.getSingleton();
    const smsBankRegex = botConfig?.smsBankRegex || '';

    let extractedAmount = null;
    if (smsBankRegex) {
      extractedAmount = extractAmountWithRegex(smsText, smsBankRegex);
    }
    if (!extractedAmount) {
      extractedAmount = extractBankMelliAmount(smsText);
    }
    if (!extractedAmount) {
      return res.status(400).json({ success: false, error: 'Could not extract amount from SMS' });
    }

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        // Atomically claim the matching transaction — userId + amount ensures deterministic ownership
        const updated = await Transaction.findOneAndUpdate(
          {
            userId,
            amount: extractedAmount,
            'metadata.cryptomusStatus': 'pending_sms_verification',
            status: 'pending',
            createdAt: { $gte: thirtyMinutesAgo },
          },
          {
            $set: {
              status: 'completed',
              'metadata.cryptomusStatus': 'sms_verified',
              'metadata.verifiedAt': new Date(),
            },
          },
          { new: true, session },
        );

        if (!updated) {
          throw new Error('No matching pending transaction found');
        }

        const user = await User.findById(userId).session(session);
        if (!user) {
          throw new Error('User not found');
        }

        const newBalance = user.walletBalance + updated.amount;
        user.walletBalance = newBalance;
        await user.save({ session });

        // Record final balance on the transaction
        await Transaction.updateOne(
          { _id: updated._id },
          { $set: { balanceAfter: newBalance } },
          { session },
        );

        return {
          success: true,
          transactionId: updated._id,
          userId,
          amount: updated.amount,
          newBalance,
        };
      });

      return res.json(result);
    } finally {
      await session.endSession();
    }
  } catch (err) {
    if (err.message === 'No matching pending transaction found') {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message === 'User not found') {
      return res.status(404).json({ success: false, error: err.message });
    }
    console.error('[handleSmsWebhook] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
