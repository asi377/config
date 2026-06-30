/**
 * i18n.js
 *
 * Minimal flat-key translation helper for the Telegram bot.
 * Locale JSON files are loaded once at module init (not per-call).
 */

import en from '../locales/en.json' with { type: 'json' };
import fa from '../locales/fa.json' with { type: 'json' };
import ru from '../locales/ru.json' with { type: 'json' };

export const SUPPORTED_LANGS = ['en', 'fa', 'ru'];

const DICTIONARIES = { en, fa, ru };
const FALLBACK_LANG = 'fa';

function interpolate(template, vars) {
  if (!vars || typeof template !== 'string') return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Translate a key into the given language, falling back to Persian and
 * then to the raw key if no translation is found.
 *
 * @param {string} key
 * @param {string} [lang='fa']
 * @param {object} [vars={}] - interpolation values for `{{var}}` placeholders
 * @returns {string}
 */
export function t(key, lang = FALLBACK_LANG, vars = {}) {
  const dict = DICTIONARIES[lang] || DICTIONARIES[FALLBACK_LANG];
  let template = dict?.[key];

  if (template === undefined && lang !== FALLBACK_LANG) {
    template = DICTIONARIES[FALLBACK_LANG]?.[key];
  }

  if (template === undefined) {
    template = key;
  }

  return interpolate(template, vars);
}

export default { t, SUPPORTED_LANGS };
