import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import BotConfig from '../models/BotConfig.js';

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
      if (!isNaN(amount) && amount > 0) return amount;
    }
  }
  return null;
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
    if (!smsText) {
      return res.status(400).json({ success: false, error: 'Missing SMS text in request body' });
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
        const transaction = await Transaction.findOne({
          amount: extractedAmount,
          status: 'pending_sms_verification',
          createdAt: { $gte: thirtyMinutesAgo },
        }).session(session);

        if (!transaction) {
          throw new Error('No matching pending transaction found');
        }

        const user = await User.findById(transaction.userId).session(session);
        if (!user) {
          throw new Error('User not found');
        }

        transaction.status = 'PAID';
        transaction.verifiedAt = new Date();
        await transaction.save({ session });

        user.walletBalance += transaction.amount;
        await user.save({ session });

        transaction.balanceAfter = user.walletBalance;
        await transaction.save({ session });

        return {
          success: true,
          transactionId: transaction._id,
          userId: user._id,
          amount: transaction.amount,
          newBalance: user.walletBalance,
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
