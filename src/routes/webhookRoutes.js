import { Router } from 'express';
import { smsAuth } from '../middlewares/auth.js';
import PaymentService from '../services/PaymentService.js';
import paymentGateway from '../billing/gateway/index.js';
import { handleSmsWebhook } from '../utils/smsParser.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
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

// ── Mock payment webhook (LOCAL / DEV testing) ────────────────────────────────
// Lets you exercise the full approve → provision → config-delivery pipeline
// without a real bank SMS. Guarded by the admin API key (open in non-production).
//
// Modes (JSON body):
//   1. Direct receipt approval/rejection (runs provisioning on success):
//        { "receiptId": "<id>", "status": "success" | "failure" }
//        { "latestPending": true, "status": "success" }
//   2. Raw SMS passthrough (exercises the real SMS-match + auto-approve path):
//        { "smsText": "مبلغ 150000 ريال ..." }
router.post('/mock-payment', webhookLimiter, async (req, res) => {
  const key = req.headers['x-api-key'];
  if (config.env === 'production' && key !== config.adminApiKey) {
    return res.status(401).json({ success: false, error: 'x-api-key required in production' });
  }

  try {
    const { receiptId, status = 'success', latestPending, smsText } = req.body || {};
    const bot = req.app.get('bot');

    // Mode 2 — feed a raw SMS through the genuine matching pipeline.
    if (smsText) {
      await PaymentService.processSmsWebhook(smsText, bot);
      return res.json({ success: true, mode: 'sms-passthrough', note: 'Check logs + receipt status.' });
    }

    // Mode 1 — resolve the target receipt.
    const Receipt = (await import('../models/Receipt.js')).default;
    let receipt = null;
    if (receiptId) {
      receipt = await Receipt.findById(receiptId);
    } else if (latestPending) {
      receipt = await Receipt.findOne({ status: { $in: ['pending', 'sms_matched'] } }).sort({ createdAt: -1 });
    }
    if (!receipt) {
      return res.status(404).json({
        success: false,
        error: 'No target receipt. Provide receiptId, latestPending:true, or smsText.',
      });
    }

    const action = status === 'failure' ? 'reject' : 'approve';
    const result = await PaymentService.processReceipt(receipt._id, null, action, { auto: true });

    const subLink = result.tunnelConfig
      ? `${config.backendUrl}/sub/${result.tunnelConfig.uuid}`
      : null;

    return res.json({
      success: true,
      mode: 'direct-receipt',
      action,
      receiptId: String(receipt._id),
      receiptStatus: result.receipt?.status || null,
      subscriptionId: result.subscription?._id ? String(result.subscription._id) : null,
      subLink,
    });
  } catch (err) {
    logger.error({ err }, '[mock-payment] processing error');
    return res.status(500).json({ success: false, error: err.message });
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
