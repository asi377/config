import BotConfig from '../../models/BotConfig.js';

/**
 * Catch-all callback handler for admin-defined custom menu items.
 * Must be registered AFTER every built-in bot.action(...) call: Telegraf
 * composes action handlers in registration order, so any callback_data that
 * already matched a built-in handler never reaches this one.
 */
export async function handleDynamicMenuAction(ctx) {
  const actionId = ctx.callbackQuery?.data;
  if (!actionId) return;

  const config = await BotConfig.getSingleton();
  const item = (config.botMenus || []).find((m) => m.actionId === actionId);

  if (!item || item.type !== 'custom') {
    return ctx.answerCbQuery();
  }

  const keyboard = (item.followUpButtons || []).map((button) => [
    { text: button.text, callback_data: button.actionId },
  ]);
  keyboard.push([{ text: '🔙 منوی اصلی', callback_data: 'main_menu' }]);

  await ctx.answerCbQuery();
  try {
    await ctx.editMessageText(item.messageText || '', { reply_markup: { inline_keyboard: keyboard } });
  } catch {
    await ctx.reply(item.messageText || '', { reply_markup: { inline_keyboard: keyboard } });
  }
}
