import SettingRepository from '../../repositories/SettingRepository.js';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';

/** Actions that must never be blocked by the force-subscribe gate. */
const ALLOWLISTED_ACTIONS = ['change_language', 'force_subscribe_recheck'];

/**
 * Reads the configured force-subscribe channel list from Settings, seeding
 * it from the legacy CHANNEL_ID env var on first use if no Setting exists yet.
 */
async function getChannels() {
  const channels = await SettingRepository.get('forceSubscribe.channels', null);
  if (channels !== null) return channels;

  if (config.channelId) {
    const seeded = [{ id: config.channelId, inviteLink: '', title: config.channelId }];
    await SettingRepository.set('forceSubscribe.channels', seeded);
    return seeded;
  }

  return [];
}

/**
 * Checks the given Telegram user's membership against all configured
 * channels and returns the subset they have not joined. Channels for which
 * the membership lookup itself fails (e.g. bot not admin in channel, or
 * invalid chat id) are treated as "not joined" (fail closed).
 */
export async function getUnjoinedChannels(ctx, channels) {
  const unjoined = [];
  for (const ch of channels) {
    try {
      const member = await ctx.telegram.getChatMember(ch.id, ctx.from.id);
      if (['left', 'kicked'].includes(member.status)) unjoined.push(ch);
    } catch (err) {
      logger.warn({ err, channelId: ch.id }, '[forceSubscribe] getChatMember failed, treating as not joined');
      unjoined.push(ch);
    }
  }
  return unjoined;
}

/** Builds the blocking prompt message + inline keyboard for unjoined channels. */
export function buildPromptMessage(ctx, unjoined) {
  return {
    text: t('force_subscribe.prompt', ctx.lang),
    extra: {
      reply_markup: {
        inline_keyboard: [
          ...unjoined.map((ch) => [
            { text: t('force_subscribe.join_btn', ctx.lang, { title: ch.title || ch.id }), url: ch.inviteLink },
          ]),
          [{ text: t('force_subscribe.recheck_btn', ctx.lang), callback_data: 'force_subscribe_recheck' }],
        ],
      },
    },
  };
}

export async function forceSubscribeMiddleware(ctx, next) {
  const enabled = await SettingRepository.get('forceSubscribe.enabled', false);
  if (!enabled) return next();

  const channels = await getChannels();
  if (!channels.length) return next();

  // Allowlist: never block /start, language switching, or the recheck callback itself.
  if (ctx.updateType === 'message' && ctx.message?.text?.startsWith('/start')) return next();
  if (ctx.updateType === 'message' && ctx.message?.text === '/language') return next();
  if (ctx.callbackQuery?.data && ALLOWLISTED_ACTIONS.includes(ctx.callbackQuery.data)) return next();

  if (!ctx.from?.id) return next();

  const unjoined = await getUnjoinedChannels(ctx, channels);
  if (unjoined.length) {
    const { text, extra } = buildPromptMessage(ctx, unjoined);
    await ctx.reply(text, extra);
    return; // block — do not call next()
  }

  return next();
}

export default forceSubscribeMiddleware;
