import crypto from 'crypto';
import { randomBytes } from 'crypto';
import logger from '../config/logger.js';

const CA_KEY = Symbol('caKey');
const CA_CERT = Symbol('caCert');

class CertManager {
  constructor() {
    this[CA_KEY] = null;
    this[CA_CERT] = null;
    this.nodeCerts = new Map();
  }

  async initialize() {
    const keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this[CA_KEY] = keyPair.privateKey;

    this[CA_CERT] = {
      publicKey: keyPair.publicKey,
      fingerprint: this._fingerprint(keyPair.publicKey),
      issuedAt: new Date(),
    };

    logger.info('[certs] CA initialized');
    return this[CA_CERT];
  }

  async generateNodeCert(nodeId) {
    const keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const cert = {
      nodeId,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      fingerprint: this._fingerprint(keyPair.publicKey),
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      issuerFingerprint: this[CA_CERT]?.fingerprint,
    };

    const signature = this._sign(cert);
    cert.signature = signature;

    this.nodeCerts.set(nodeId, cert);
    logger.info({ nodeId, expiresAt: cert.expiresAt }, '[certs] Node cert generated');
    return cert;
  }

  async rotateNodeCert(nodeId) {
    return this.generateNodeCert(nodeId);
  }

  verifyNodeCert(nodeId, certData) {
    const stored = this.nodeCerts.get(nodeId);
    if (!stored) return { valid: false, reason: 'NO_CERT_FOUND' };

    if (new Date() > stored.expiresAt) return { valid: false, reason: 'CERT_EXPIRED' };

    const expectedFingerprint = this._fingerprint(stored.publicKey);
    if (certData.fingerprint !== expectedFingerprint) {
      return { valid: false, reason: 'FINGERPRINT_MISMATCH' };
    }

    return { valid: true, cert: stored };
  }

  async generateNonce() {
    return randomBytes(32).toString('hex');
  }

  verifyNonce(nonce, storedNonces) {
    if (storedNonces.has(nonce)) return false;
    storedNonces.add(nonce);
    return true;
  }

  _sign(data) {
    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify({ nodeId: data.nodeId, fingerprint: data.fingerprint, expiresAt: data.expiresAt }));
    sign.end();
    return sign.sign(this[CA_KEY], 'hex');
  }

  _fingerprint(publicKey) {
    return crypto.createHash('sha256').update(publicKey).digest('hex');
  }

  getNodeCert(nodeId) {
    return this.nodeCerts.get(nodeId);
  }

  removeNodeCert(nodeId) {
    this.nodeCerts.delete(nodeId);
    logger.info({ nodeId }, '[certs] Node cert revoked');
  }
}

export default new CertManager();
