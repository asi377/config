import { Router } from 'express';
import { smsAuth } from '../middlewares/auth.js';
import PaymentService from '../services/PaymentService.js';
import logger from '../config/logger.js';

const router = Router();

// SMS C2C webhook - legacy endpoint kept for backward compatibility
router.post('/sms', smsAuth, (req, res) => {
  const smsText = req.body?.message || req.body?.text || '';
  if (!smsText) {
    return res.status(400).json({ error: 'Missing message body' });
  }

  const bot = req.app.get('bot');
  if (!bot) {
    return res.status(500).json({ error: 'Bot instance not available' });
  }

  PaymentService.processSmsWebhook(smsText, bot).catch((err) => {
    logger.error({ err }, '[sms-webhook] processing error');
  });

  res.json({ ok: true });
});

// SMS C2C webhook - updated endpoint using SmsC2CGateway
router.post('/sms-v2', smsAuth, async (req, res) => {
  const smsText = req.body?.message || req.body?.text || '';
  if (!smsText) {
    return res.status(400).json({ success: false, error: 'Missing message body' });
  }

  try {
    const bot = req.app.get('bot');
    if (!bot) {
      return res.status(500).json({ success: false, error: 'Bot instance not available' });
    }

    const result = await PaymentService.processSmsC2CWebhook(smsText, bot);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, '[sms-webhook-v2] processing error');
    res.status(500).json({ success: false, error: 'Failed to process webhook' });
  }
});

// Cryptomus webhook
router.post('/cryptomus', async (req, res) => {
  try {
    const headers = {
      'cryptomus-signature': req.headers['cryptomus-signature'] || req.headers['x-cryptomus-signature'],
      'content-type': req.headers['content-type'] || 'application/json',
    };

    const result = await PaymentService.processCryptomusWebhook(req.body, headers);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, '[cryptomus-webhook] processing error');
    res.status(500).json({ success: false, error: 'Failed to process webhook' });
  }
});

export default router;
