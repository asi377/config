import { SUPPORTED_LANGS } from '../../utils/i18n.js';

/**
 * Sets ctx.lang from ctx.user.language (populated upstream by
 * resolveUserMiddleware). Must be registered AFTER resolveUserMiddleware.
 * Defaults to 'fa' when missing or unsupported.
 */
export function languageMiddleware() {
  return async (ctx, next) => {
    const userLang = ctx.user?.language;
    ctx.lang = SUPPORTED_LANGS.includes(userLang) ? userLang : 'fa';
    return next();
  };
}

export default languageMiddleware;
