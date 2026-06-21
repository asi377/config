import BaseService from '../shared/BaseService.js';
import logger from '../config/logger.js';

class WebhookService extends BaseService {
  sendEvent(eventType, payload) {
    const url = process.env.WEBHOOK_URL;
    if (!url) return;

    const body = { event: eventType, timestamp: new Date().toISOString(), data: payload };

    setImmediate(async () => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          logger.warn({ status: response.status, eventType }, '[webhook] non-ok response');
        }
      } catch (err) {
        logger.warn({ err, eventType }, '[webhook] network error');
      }
    });
  }
}

export default new WebhookService();
