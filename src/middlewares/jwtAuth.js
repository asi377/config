import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export function jwtAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, config.jwt.secret);
    // Access tokens are signed with the admin id in `sub` and the session id in
    // `jti` (see AdminAuthService._issueTokens). Fall back to `adminId` for any
    // legacy tokens still in circulation.
    req.adminId = decoded.sub || decoded.adminId;
    req.tokenId = decoded.jti;
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function optionalJwtAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.adminId = decoded.sub || decoded.adminId;
    req.tokenId = decoded.jti;
    req.admin = decoded;
  } catch {
    // Invalid/expired token on an optional route: proceed unauthenticated.
  }
  next();
}
