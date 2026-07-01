import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import en from './en.json';
import fa from './fa.json';

const DICTS = { en, fa };
const RTL_LANGS = new Set(['fa']);
const STORAGE_KEY = 'admin_lang';

const I18nContext = createContext(null);

/** Detect the initial language: saved preference → browser → default 'en'. */
function detectInitialLang() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && DICTS[saved]) return saved;
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return DICTS[browser] ? browser : 'en';
}

/** Resolve a dotted key path (e.g. "nav.users") against a dictionary. */
function resolve(dict, key) {
  return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), dict);
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(detectInitialLang);

  // Persist + set document direction/lang for correct RTL rendering.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
  }, [lang]);

  const t = useCallback(
    (key, vars) => {
      let str = resolve(DICTS[lang], key) ?? resolve(DICTS.en, key) ?? key;
      if (vars && typeof str === 'string') {
        for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{{${k}}}`, v);
      }
      return str;
    },
    [lang],
  );

  const toggle = useCallback(() => setLang((l) => (l === 'fa' ? 'en' : 'fa')), []);

  const value = useMemo(
    () => ({ lang, setLang, toggle, t, dir: RTL_LANGS.has(lang) ? 'rtl' : 'ltr' }),
    [lang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
