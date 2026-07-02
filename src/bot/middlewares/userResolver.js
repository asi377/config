import UserService from '../../services/UserService.js';

export function resolveUserMiddleware(referralCode) {
  return async (ctx, next) => {
    const code = referralCode || ctx.payload?.trim().toUpperCase();
    const validCode = code && code.length <= 10 ? code : null;
    ctx.user = await UserService.resolveUser(ctx.from.id, validCode, ctx.from);
    return next();
  };
}
