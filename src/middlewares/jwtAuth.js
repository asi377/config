import jwt from 'jsonwebtoken';
import { AuthError } from '../shared/errors.js';
import config from '../config/index.js';
import AdminRepository from '../repositories/AdminRepository.js';
import SessionRepository from '../repositories/SessionRepository.js';

function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1];
}

export async function jwtAuth(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return next(new AuthError('Missing or invalid authorization header'));
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret);

    const session = await SessionRepository.findByTokenId(payload.jti);
    if (!session) {
      return next(new AuthError('Session revoked or expired'));
    }

    const admin = await AdminRepository.findActiveById(payload.sub);
    if (!admin) {
      return next(new AuthError('Admin account not found or inactive'));
    }

    req.admin = admin;
    req.adminId = admin._id;
    req.adminRole = admin.role;
    req.tokenId = payload.jti;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AuthError('Access token expired'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AuthError('Invalid access token'));
    }
    return next(new AuthError('Authentication failed'));
  }
}

export async function optionalJwtAuth(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    req.admin = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    const admin = await AdminRepository.findActiveById(payload.sub);
    req.admin = admin || null;
    req.adminId = admin?._id || null;
    req.adminRole = admin?.role || null;
    req.tokenId = payload.jti || null;
  } catch {
    req.admin = null;
  }

  next();
}

export { jwtAuth as default };
