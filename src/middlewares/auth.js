import crypto from 'crypto';
import { AuthError, ForbiddenError } from '../shared/errors.js';
import User from '../models/User.js';
import config from '../config/index.js';

function timingSafeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function apiKeyAuth(req, _res, next) {
  const key = req.headers['x-api-key'];
  if (!key || !config.adminApiKey || !timingSafeEqual(key, config.adminApiKey)) {
    return next(new AuthError('Unauthorized — invalid or missing API key'));
  }
  next();
}

export async function enterpriseAuth(req, _res, next) {
  const key = req.headers['x-api-key'];
  if (!key || !config.adminApiKey || !timingSafeEqual(key, config.adminApiKey)) {
    return next(new AuthError('Unauthorized — invalid or missing API key'));
  }

  const adminId = req.headers['x-admin-id'];
  if (!adminId) {
    return next(new AuthError('x-admin-id header is required'));
  }

  try {
    const admin = await User.findById(adminId).lean();
    if (!admin || !['superadmin', 'support'].includes(admin.role)) {
      return next(new ForbiddenError('Insufficient permissions'));
    }
    req.adminId = admin._id;
    req.adminRole = admin.role;
    next();
  } catch {
    return next(new AuthError('Internal error during authentication'));
  }
}

export function smsAuth(req, _res, next) {
  const secret = req.headers['x-sms-secret'];
  if (!secret || !config.smsSecret || !timingSafeEqual(secret, config.smsSecret)) {
    return next(new AuthError('Unauthorized'));
  }
  next();
}
