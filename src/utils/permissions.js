export const ROLES = [
  'superadmin',
  'admin',
  'support',
  'finance',
  'analyst',
  'moderator',
];

export const PERMISSIONS = [
  // Users
  'users.read',
  'users.write',
  'users.ban',
  'users.delete',
  'users.wallet',
  // Payments
  'payments.read',
  'payments.approve',
  'payments.refund',
  'payments.export',
  // Subscriptions
  'subscriptions.read',
  'subscriptions.write',
  'subscriptions.cancel',
  // Plans
  'plans.read',
  'plans.write',
  'plans.delete',
  // Servers
  'servers.read',
  'servers.write',
  'servers.manage',
  'servers.delete',
  // Configs
  'configs.read',
  'configs.write',
  'configs.delete',
  // Analytics
  'analytics.view',
  'analytics.export',
  // Tickets
  'tickets.read',
  'tickets.write',
  'tickets.close',
  // Promo Codes
  'promo.read',
  'promo.write',
  'promo.delete',
  // Settings
  'settings.read',
  'settings.write',
  // Audit
  'audit.read',
  'audit.export',
  // Admin Management
  'admin.read',
  'admin.write',
  'admin.delete',
  // Fraud
  'fraud.read',
  'fraud.resolve',
  // Reseller
  'reseller.read',
  'reseller.write',
];

export const ROLE_PERMISSIONS = {
  superadmin: ['*'],
  admin: [
    'users.read', 'users.write', 'users.ban', 'users.wallet',
    'payments.read', 'payments.approve', 'payments.refund',
    'subscriptions.read', 'subscriptions.write', 'subscriptions.cancel',
    'plans.read', 'plans.write', 'plans.delete',
    'servers.read', 'servers.write', 'servers.manage',
    'configs.read', 'configs.write', 'configs.delete',
    'analytics.view',
    'tickets.read', 'tickets.write', 'tickets.close',
    'promo.read', 'promo.write', 'promo.delete',
    'settings.read', 'settings.write',
    'audit.read',
    'fraud.read', 'fraud.resolve',
    'reseller.read', 'reseller.write',
  ],
  support: [
    'users.read',
    'subscriptions.read',
    'configs.read',
    'tickets.read', 'tickets.write', 'tickets.close',
    'audit.read',
    'fraud.read',
  ],
  finance: [
    'users.read', 'users.wallet',
    'payments.read', 'payments.approve', 'payments.refund', 'payments.export',
    'subscriptions.read',
    'plans.read',
    'analytics.view', 'analytics.export',
    'promo.read', 'promo.write',
  ],
  analyst: [
    'users.read',
    'subscriptions.read',
    'payments.read',
    'analytics.view', 'analytics.export',
    'audit.read',
  ],
  moderator: [
    'users.read', 'users.write', 'users.ban',
    'tickets.read', 'tickets.write', 'tickets.close',
    'configs.read',
    'fraud.read',
  ],
};

export function getPermissionsForRole(role) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return [];
  if (perms.includes('*')) return ['*'];
  return perms;
}

export function hasPermission(adminPermissions, requiredPermission) {
  if (!adminPermissions || adminPermissions.length === 0) return false;
  if (adminPermissions.includes('*')) return true;

  const exact = adminPermissions.includes(requiredPermission);

  const wildcard = adminPermissions.some((p) => {
    if (!p.endsWith('.*')) return false;
    const prefix = p.slice(0, -2);
    return requiredPermission.startsWith(prefix + '.');
  });

  return exact || wildcard;
}

export function checkPermission(admin, requiredPermission) {
  if (!admin) return false;
  if (admin.role === 'superadmin') return true;
  const permissions = admin.permissions && admin.permissions.length > 0
    ? admin.permissions
    : getPermissionsForRole(admin.role);
  return hasPermission(permissions, requiredPermission);
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!checkPermission(req.admin, permission)) {
      return res.status(403).json({ success: false, error: `Insufficient permissions: ${permission} required` });
    }
    next();
  };
}

export default {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  hasPermission,
  checkPermission,
  requirePermission,
};
