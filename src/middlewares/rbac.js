import { checkPermission } from '../utils/permissions.js';

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const hasAccess = checkPermission(req.admin, permission);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: `Insufficient permissions: "${permission}" required`,
      });
    }

    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: `Requires one of roles: ${roles.join(', ')}`,
      });
    }

    next();
  };
}

export function requireAllPermissions(...permissions) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    for (const perm of permissions) {
      if (!checkPermission(req.admin, perm)) {
        return res.status(403).json({
          success: false,
          error: `Missing permission: "${perm}"`,
        });
      }
    }

    next();
  };
}

export default { requirePermission, requireRole, requireAllPermissions };
