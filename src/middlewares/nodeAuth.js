import crypto from 'crypto';
import { AuthError } from '../shared/errors.js';
import ServerRepository from '../repositories/ServerRepository.js';
import config from '../config/index.js';
import certManager from '../crypto/CertManager.js';

const NODE_SECRET = config.nodeSecret;

const nonceCache = new Set();

export function verifyBootstrapToken(bootstrapToken) {
  if (!bootstrapToken || typeof bootstrapToken !== 'string') return null;
  const parts = bootstrapToken.split(':');
  if (parts.length !== 3) return null;
  const [serverId, expiry, hmac] = parts;
  if (!serverId || !expiry || !hmac) return null;
  const payload = `${serverId}:${expiry}`;
  const expectedHmac = crypto.createHmac('sha256', NODE_SECRET).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) return null;
  } catch {
    return null;
  }
  if (Date.now() > parseInt(expiry, 10)) return null;
  return serverId;
}

function verifyNonce(nonce) {
  if (!nonce || nonce.length < 16) return false;
  if (nonceCache.has(nonce)) return false;
  nonceCache.add(nonce);
  if (nonceCache.size > 100000) {
    const toDelete = [...nonceCache].slice(0, 50000);
    toDelete.forEach(n => nonceCache.delete(n));
  }
  return true;
}

function verifyHMACSignature({ signature, timestamp, nonce, method, path, body, secret }) {
  if (!signature || !timestamp || !nonce) return false;

  const now = Date.now();
  if (now - parseInt(timestamp, 10) > 30000) return false;

  if (!verifyNonce(nonce)) return false;

  const payload = `${timestamp}.${nonce}.${method}.${path}.${JSON.stringify(body || {})}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function verifyTLS(req) {
  const cert = req.socket?.getPeerCertificate?.();
  if (!cert || !Object.keys(cert).length) return null;

  const nodeId = cert.subject?.CN;
  if (!nodeId) return null;

  const stored = certManager.getNodeCert(nodeId);
  if (!stored) return null;

  const fingerprint = crypto.createHash('sha256').update(cert.raw).digest('hex');
  if (fingerprint !== stored.fingerprint) return null;

  return nodeId;
}

export async function nodeAuth(req, _res, next) {
  // Try mTLS first (zero-trust path)
  const tlsNodeId = await verifyTLS(req);
  if (tlsNodeId) {
    const server = await ServerRepository.findById(tlsNodeId);
    if (server) {
      req.nodeServer = server;
      req.nodeServerId = server._id;
      req.authMethod = 'mtls';
      return next();
    }
  }

  // Fallback: token + HMAC signature with nonce
  const nodeToken = req.headers['x-node-token'] || req.body?.nodeToken;
  const signature = req.headers['x-node-signature'];
  const timestamp = req.headers['x-node-timestamp'];
  const nonce = req.headers['x-node-nonce'];

  if (!nodeToken) {
    return next(new AuthError('Node authentication required'));
  }

  const server = await ServerRepository.findOne({ nodeToken });
  if (!server) {
    return next(new AuthError('Unknown node'));
  }

  if (signature && timestamp && nonce) {
    const valid = verifyHMACSignature({
      signature, timestamp, nonce,
      method: req.method,
      path: req.originalUrl || req.url,
      body: req.body,
      secret: nodeToken,
    });
    if (!valid) {
      return next(new AuthError('Invalid request signature or nonce replayed'));
    }
  } else {
    // Require signature for state-changing operations
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next(new AuthError('Signed requests required for this operation'));
    }
  }

  req.nodeServer = server;
  req.nodeServerId = server._id;
  req.authMethod = 'token';
  next();
}

export async function nodeRegistrationAuth(req, _res, next) {
  const token = req.body?.nodeToken || req.body?.bootstrapToken;
  if (!token) {
    return next(new AuthError('nodeToken or bootstrapToken is required'));
  }

  const serverId = verifyBootstrapToken(token);
  if (serverId) {
    const server = await ServerRepository.findById(serverId);
    if (server) {
      req.nodeServer = server;
      req.nodeServerId = server._id;
      req.isBootstrapRegistration = true;
      return next();
    }
  }

  const existing = await ServerRepository.findOne({ nodeToken: token });
  if (existing) {
    req.nodeServer = existing;
    req.nodeServerId = existing._id;
  }

  next();
}

export async function optionalNodeAuth(req, _res, next) {
  const tlsNodeId = await verifyTLS(req);
  if (tlsNodeId) {
    const server = await ServerRepository.findById(tlsNodeId);
    if (server) {
      req.nodeServer = server;
      req.nodeServerId = server._id;
      req.authMethod = 'mtls';
    }
  }

  const nodeToken = req.headers['x-node-token'] || req.body?.nodeToken;
  if (nodeToken) {
    const server = await ServerRepository.findOne({ nodeToken });
    if (server) {
      req.nodeServer = server;
      req.nodeServerId = server._id;
      req.authMethod = 'token';
    }
  }

  next();
}

export default { nodeAuth, nodeRegistrationAuth, optionalNodeAuth };
