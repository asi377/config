import { describe, expect, test } from '@jest/globals';
import { signRequest, verifyRequestSignature } from './signer.js';

describe('request signer', () => {
  test('accepts a valid signed payload', () => {
    const secret = 'node-secret-with-enough-length';
    const signed = signRequest({ serverId: 'srv-1', status: 'healthy' }, secret);

    expect(verifyRequestSignature(signed, secret).valid).toBe(true);
  });

  test('rejects nonce replay', () => {
    const secret = 'node-secret-with-enough-length';
    const nonceStore = new Set();
    const signed = signRequest({ serverId: 'srv-1' }, secret);

    expect(verifyRequestSignature(signed, secret, { nonceStore }).valid).toBe(true);
    expect(verifyRequestSignature(signed, secret, { nonceStore })).toEqual({
      valid: false,
      reason: 'NONCE_REPLAYED',
    });
  });

  test('rejects tampered payloads', () => {
    const secret = 'node-secret-with-enough-length';
    const signed = signRequest({ amount: 1000 }, secret);

    expect(
      verifyRequestSignature({ ...signed, payload: { amount: 9999 } }, secret),
    ).toEqual({
      valid: false,
      reason: 'SIGNATURE_MISMATCH',
    });
  });
});
