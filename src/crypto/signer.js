import crypto from 'crypto';

export function signRequest(payload, secret) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const data = `${timestamp}.${nonce}.${JSON.stringify(payload)}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return { timestamp, nonce, signature, payload };
}

export function verifyRequestSignature({ timestamp, nonce, signature, payload }, secret, opts = {}) {
  const maxAge = opts.maxAge || 30000;
  const nonceStore = opts.nonceStore || new Set();

  const now = Date.now();
  if (now - parseInt(timestamp) > maxAge) {
    return { valid: false, reason: 'TIMESTAMP_EXPIRED' };
  }

  if (nonceStore.has(nonce)) {
    return { valid: false, reason: 'NONCE_REPLAYED' };
  }

  const data = `${timestamp}.${nonce}.${JSON.stringify(payload)}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');

  try {
    const match = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!match) return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  } catch {
    return { valid: false, reason: 'SIGNATURE_ERROR' };
  }

  nonceStore.add(nonce);
  return { valid: true };
}

export function generateNodeSecret() {
  return crypto.randomBytes(48).toString('hex');
}
