import { Markup } from 'telegraf';
import { t } from '../../utils/i18n.js';

/**
 * renderAdminDefinedMenu(ctx, menuId)
 *
 * Reads BotConfig.getSingleton() fresh from the DB (no caching — it's cheap)
 * and renders the admin-configured buttons for the given menuId as an inline
 * keyboard. This layers on top of the existing hardcoded flows; it does not
 * replace them.
 *
 * Button resolution:
 *   - Buttons belong to a "menu" by `action.nextMenuId` chain: top-level menu
 *     is identified by `menuId === null` (buttons not gated behind any
 *     nextMenuId), otherwise buttons reachable via a `nextMenu` action whose
 *     `nextMenuId` equals the requested menuId.
 *   - Buttons are grouped by `row` and ordered by `order` within each row.
 *   - Label falls back through: t()-resolved translation for the button's
 *     own text (if it happens to match a known key) → admin-configured
 *     per-language text → English text → Persian text → buttonId.
 *   - Selecting a `nextMenu` button re-renders this same function with the
 *     new menuId; a `staticAction` button fires the existing callback_data
 *     for that action (delegates to already-registered hardcoded handlers).
 *
 * @param {import('telegraf').Context} ctx
 * @param {string|null} menuId
 */
export async function renderAdminDefinedMenu(ctx, menuId = null) {
  const lang = ctx.lang || 'fa';
  const BotConfig = (await import('../../models/BotConfig.js')).default;
  const config = await BotConfig.getSingleton();

  const buttons = (config.botMenus || []).filter((btn) => {
    const targetMenu = btn.menuId || null; // optional grouping field, defaults to top-level
    return targetMenu === menuId;
  });

  if (buttons.length === 0) {
    const text = menuId
      ? t('error_not_found', lang, { resource: menuId })
      : (config.welcomeText?.[lang] || config.welcomeText?.fa || config.welcomeText?.en || t('welcome_title', lang));
    return ctx.reply(text, Markup.inlineKeyboard([
      [Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')],
    ]));
  }

  const sorted = [...buttons].sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.order ?? 0) - (b.order ?? 0));

  const grouped = sorted.reduce((acc, btn) => {
    const row = btn.row ?? 0;
    if (!acc[row]) acc[row] = [];
    acc[row].push(btn);
    return acc;
  }, {});

  const rows = Object.keys(grouped)
    .sort((a, b) => Number(a) - Number(b))
    .map((rowKey) => grouped[rowKey].map((btn) => {
      const label = btn.text?.[lang] || btn.text?.fa || btn.text?.en || btn.buttonId;
      const callbackData = btn.action?.type === 'nextMenu'
        ? `custom_menu_${btn.action.nextMenuId}`
        : (btn.action?.staticAction || `custom_menu_${btn.buttonId}`);
      return Markup.button.callback(label, callbackData);
    }));

  rows.push([Markup.button.callback(t('btn_back_main_menu', lang), 'main_menu')]);

  const welcomeText = config.welcomeText?.[lang] || config.welcomeText?.fa || config.welcomeText?.en || '';
  const text = welcomeText || t('main_menu_title', lang);

  if (ctx.callbackQuery) {
    return ctx.editMessageText(text, Markup.inlineKeyboard(rows));
  }
  return ctx.reply(text, Markup.inlineKeyboard(rows));
}

export default { renderAdminDefinedMenu };
