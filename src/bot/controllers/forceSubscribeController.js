import SettingRepository from '../../repositories/SettingRepository.js';
import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';
import { getUnjoinedChannels, buildPromptMessage } from '../middlewares/forceSubscribeMiddleware.js';
import { mainMenuKeyboard } from '../keyboards.js';

/**
 * Handles the "I've joined" recheck button. Re-runs the same membership
 * check used by the gate middleware: if the user has joined all required
 * channels, confirm and render the main menu; otherwise re-show the
 * blocking prompt (limited to the channels still not joined).
 */
export async function handleForceSubscribeRecheck(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    const channels = await SettingRepository.get('forceSubscribe.channels', []);
    const unjoined = await getUnjoinedChannels(ctx, channels);

    if (unjoined.length) {
      await ctx.answerCbQuery(t('force_subscribe.still_not_joined', lang), { show_alert: true });
      const { text, extra } = buildPromptMessage(ctx, unjoined);
      await ctx.editMessageText(text, extra);
      return;
    }

    await ctx.answerCbQuery(t('force_subscribe.confirmed', lang));
    await ctx.editMessageText(t('main_menu_title', lang), {
      reply_markup: mainMenuKeyboard(lang).reply_markup,
    });
  } catch (err) {
    logger.error({ err }, '[forceSubscribe] handleForceSubscribeRecheck error');
    try {
      await ctx.answerCbQuery();
    } catch {
      // ignore secondary failure
    }
  }
}

export default { handleForceSubscribeRecheck };
