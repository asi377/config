import { Router } from 'express';
import { smsAuth } from '../middlewares/auth.js';
import PaymentService from '../services/PaymentService.js';
import paymentGateway from '../billing/gateway/index.js';
import { handleSmsWebhook } from '../utils/smsParser.js';
import logger from '../config/logger.js';
import { createRateLimiter } from '../middlewares/index.js';

const webhookLimiter = createRateLimiter({ windowMs: 60000, max: 60 });

const router = Router();

// SMS forwarder webhook - called by external SMS forwarder app, no JWT auth but requires smsAuth
router.post('/sms-forwarder', webhookLimiter, smsAuth, handleSmsWebhook);

// SMS C2C webhook - legacy endpoint kept for backward compatibility
router.post('/sms', webhookLimiter, smsAuth, (req, res) => {
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
router.post('/sms-v2', webhookLimiter, smsAuth, async (req, res) => {
  const smsText = req.body?.message || req.body?.text || '';
  const userId = req.body?.userId;
  if (!smsText) {
    return res.status(400).json({ success: false, error: 'Missing message body' });
  }
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  try {
    const bot = req.app.get('bot');
    if (!bot) {
      return res.status(500).json({ success: false, error: 'Bot instance not available' });
    }

    const result = await PaymentService.processSmsC2CWebhook(smsText, userId, bot);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, '[sms-webhook-v2] processing error');
    res.status(500).json({ success: false, error: 'Failed to process webhook' });
  }
});

// Cryptomus webhook - called by Cryptomus API, no JWT auth
router.post('/cryptomus', webhookLimiter, async (req, res) => {
  try {
    const headers = {
      'cryptomus-signature': req.headers['cryptomus-signature'] || req.headers['x-cryptomus-signature'],
      'content-type': req.headers['content-type'] || 'application/json',
    };

    const result = await paymentGateway.handleWebhook('cryptomus', req.body, headers);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, '[cryptomus-webhook] processing error');
    res.status(500).json({ success: false, error: 'Failed to process webhook' });
  }
});

export default router;
