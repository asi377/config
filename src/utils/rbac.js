export function hasRole(userRole, allowedRoles) {
  return allowedRoles.includes(userRole);
}

export function requireRole(allowedRoles) {
  return (ctx, next) => {
    if (!ctx.user) {
      ctx.reply('❌ دسترسی غیرمجاز. لطفاً مجدداً لاگین کنید.');
      return;
    }
    if (!hasRole(ctx.user.role, allowedRoles)) {
      ctx.reply('🚫 شما دسترسی لازم برای این عملیات را ندارید.');
      return;
    }
    return next();
  };
}
