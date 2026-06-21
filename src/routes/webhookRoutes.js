import { Router } from 'express';
import { smsAuth } from '../middlewares/auth.js';
import PaymentService from '../services/PaymentService.js';
import logger from '../config/logger.js';

const router = Router();

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

export default router;
