import { Markup } from 'telegraf';
import { SUPPORTED_LANGS } from '../utils/i18n.js';

/**
 * Admin-authored "content" buttons (BotConfig.customButtons): extra labels that
 * appear on the persistent reply keyboard and, when tapped, show a custom
 * message plus optional URL buttons. Kept entirely separate from the bot's
 * complex-logic buttons.
 *
 * A tiny in-memory cache (5s TTL) avoids a DB read on every text message while
 * still picking up panel edits almost immediately.
 */
let _cache = { at: 0, buttons: [] };
const TTL_MS = 5000;

export function invalidateCustomButtonsCache() {
  _cache = { at: 0, buttons: [] };
}

export async function getCustomButtons() {
  if (Date.now() - _cache.at < TTL_MS) return _cache.buttons;
  const BotConfig = (await import('../models/BotConfig.js')).default;
  const config = await BotConfig.getSingleton();
  const buttons = (config.customButtons || [])
    .filter((b) => b.enabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  _cache = { at: Date.now(), buttons };
  return buttons;
}

function labelFor(btn, lang) {
  return btn.label?.[lang] || btn.label?.fa || btn.label?.en || btn.key;
}

/** Reply-keyboard rows (arrays of label strings) for the enabled custom buttons. */
export async function customButtonRows(lang) {
  const buttons = await getCustomButtons();
  return buttons.map((b) => [labelFor(b, lang)]);
}

/**
 * Finds the custom button whose label (in ANY supported language) matches the
 * pressed text, so it works regardless of the user's current language.
 */
export async function matchCustomButton(text) {
  if (!text) return null;
  const buttons = await getCustomButtons();
  for (const b of buttons) {
    for (const lang of SUPPORTED_LANGS) {
      if ((b.label?.[lang] || '') === text) return b;
    }
    if (b.key === text) return b;
  }
  return null;
}

/** Sends the custom button's message + any URL sub-buttons. */
export async function renderCustomButton(ctx, btn) {
  const lang = ctx.lang || 'fa';
  const text = btn.text?.[lang] || btn.text?.fa || btn.text?.en || '';
  const links = (btn.links || []).filter((l) => l.url && l.label);
  const extra = links.length
    ? { reply_markup: Markup.inlineKeyboard(links.map((l) => [Markup.button.url(l.label, l.url)])).reply_markup }
    : {};
  await ctx.reply(text || labelFor(btn, lang), extra);
}
