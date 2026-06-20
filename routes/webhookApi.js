import { Router } from 'express';
import paymentService from '../services/PaymentService.js';

const router = Router();

router.post('/sms', (req, res) => {
  const secret = req.headers['x-sms-secret'];
  if (!secret || secret !== process.env.SMS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const smsText = req.body?.message || req.body?.text || '';
  if (!smsText) {
    return res.status(400).json({ error: 'Missing message body' });
  }

  const bot = req.app.get('bot');
  if (!bot) {
    return res.status(500).json({ error: 'Bot instance not available' });
  }

  paymentService.processSmsWebhook(smsText, bot).catch((err) => {
    console.error('[sms-webhook] processing error:', err.message);
  });

  res.json({ ok: true });
});

export default router;
