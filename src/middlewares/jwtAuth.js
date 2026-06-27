import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export function jwtAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, config.jwt.secret);
    req.adminId = decoded.adminId;
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}
