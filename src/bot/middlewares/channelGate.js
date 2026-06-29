import BotConfig from '../../models/BotConfig.js';
import redisClient from '../../redis/client.js';
import logger from '../../config/logger.js';

const CACHE_TTL_SECONDS = 300;
const MEMBER_STATUSES = new Set(['member', 'administrator', 'creator']);
const RECHECK_ACTION = 'channel_gate_recheck';

function cacheKey(chatId, userId) {
  return `botchannelgate:${chatId}:${userId}`;
}

async function isChannelMember(telegram, chatId, userId, { skipCache = false } = {}) {
  const key = cacheKey(chatId, userId);
  if (!skipCache) {
    const cached = await redisClient.get(key);
    if (cached !== null) return cached.member;
  }

  let member = false;
  try {
    const chatMember = await telegram.getChatMember(chatId, userId);
    member = MEMBER_STATUSES.has(chatMember.status);
  } catch (err) {
    logger.warn({ err: err.message, chatId, userId }, '[channelGate] getChatMember failed');
    member = false;
  }

  await redisClient.set(key, { member }, CACHE_TTL_SECONDS);
  return member;
}

async function getPendingChannels(telegram, requiredChannels, userId, { skipCache = false } = {}) {
  const pending = [];
  for (const channel of requiredChannels) {
    const member = await isChannelMember(telegram, channel.chatId, userId, { skipCache });
    if (!member) pending.push(channel);
  }
  return pending;
}

function buildJoinKeyboard(pending) {
  const rows = pending
    .filter((c) => c.inviteLink)
    .map((c) => [{ text: `📢 ${c.title || c.chatId}`, url: c.inviteLink }]);
  rows.push([{ text: '✅ عضو شدم', callback_data: RECHECK_ACTION }]);
  return rows;
}

async function sendJoinPrompt(ctx, pending) {
  const text = '🔒 برای استفاده از بات، ابتدا باید در کانال(های) زیر عضو شوید:';
  const extra = { reply_markup: { inline_keyboard: buildJoinKeyboard(pending) } };

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, extra);
    } catch {
      await ctx.reply(text, extra);
    }
  } else {
    await ctx.reply(text, extra);
  }
}

async function handleRecheck(ctx) {
  const config = await BotConfig.getSingleton();
  const userId = ctx.from?.id;

  if (!config.channelGateEnabled || !config.requiredChannels?.length || !userId) {
    return ctx.answerCbQuery('✅ عضویت شما تایید شد');
  }

  const pending = await getPendingChannels(ctx.telegram, config.requiredChannels, userId, { skipCache: true });

  if (pending.length > 0) {
    await ctx.answerCbQuery('هنوز عضو همه کانال‌ها نشده‌اید', { show_alert: true });
    return sendJoinPrompt(ctx, pending);
  }

  await ctx.answerCbQuery('✅ عضویت شما تایید شد');
  await ctx.editMessageText('✅ عضویت شما تایید شد. لطفاً دوباره /start را ارسال کنید.');
}

export async function channelGate(ctx, next) {
  if (ctx.callbackQuery?.data === RECHECK_ACTION) {
    return handleRecheck(ctx);
  }

  const userId = ctx.from?.id;
  if (!userId) return next();

  const config = await BotConfig.getSingleton();
  if (!config.channelGateEnabled || !config.requiredChannels?.length) return next();

  const pending = await getPendingChannels(ctx.telegram, config.requiredChannels, userId);
  if (pending.length === 0) return next();

  if (ctx.callbackQuery) await ctx.answerCbQuery();
  await sendJoinPrompt(ctx, pending);
}
