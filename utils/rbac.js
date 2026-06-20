/**
 * Check whether a user's role is included in the allowed roles array.
 *
 * @param {string} userRole
 * @param {string[]} allowedRoles
 * @returns {boolean}
 */
export function hasRole(userRole, allowedRoles) {
  return allowedRoles.includes(userRole);
}

/**
 * Telegraf middleware — requires one of the specified roles on ctx.user.
 * Attach ctx.user in a prior middleware (e.g., resolve the user from
 * ctx.from.id and store on ctx).
 *
 * @param {string[]} allowedRoles
 * @returns {import('telegraf').MiddlewareFn}
 */
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
