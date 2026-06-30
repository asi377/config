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
