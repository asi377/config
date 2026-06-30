const permissions = {
  'superadmin': ['*'],
  'finance': ['payments.read', 'payments.approve', 'payments.write', 'reseller.read'],
  'support': ['tickets.read', 'tickets.write', 'users.read'],
  'ops': ['servers.read', 'servers.write', 'servers.manage'],
  'analyst': ['analytics.view', 'audit.read', 'reseller.read'],
  'marketer': ['promo.read', 'promo.write', 'reseller.read', 'reseller.write'],
};

export function requirePermission(requiredPerm) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Unauthorized' });

    const userPerms = permissions[req.admin.role] || [];
    if (userPerms.includes('*') || userPerms.includes(requiredPerm)) {
      return next();
    }

    res.status(403).json({ error: 'Insufficient permissions' });
  };
}

export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Unauthorized' });

    if (allowedRoles.includes(req.admin.role)) {
      return next();
    }

    res.status(403).json({ error: 'Insufficient permissions' });
  };
}
