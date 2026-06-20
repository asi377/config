class WebhookService {

  /**
   * Fire-and-forget webhook event.  Never rejects — network errors are
   * silently logged to stderr so the caller is never blocked.
   *
   * @param {'NEW_PURCHASE'|'TICKET_CREATED'|'FRAUD_DETECTED'} eventType
   * @param {Record<string, any>} payload
   */
  sendEvent(eventType, payload) {
    const url = process.env.WEBHOOK_URL;
    if (!url) return;

    const body = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    setImmediate(async () => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          console.warn(`[webhook] ${eventType} → ${response.status} ${response.statusText}`);
        }
      } catch (err) {
        console.warn(`[webhook] ${eventType} network error:`, err.message);
      }
    });
  }
}

export default new WebhookService();
