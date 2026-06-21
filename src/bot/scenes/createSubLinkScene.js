import { Scenes } from 'telegraf';
import UserService from '../../services/UserService.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import TunnelService from '../../services/TunnelService.js';
import { formatBytes, formatError } from '../utils.js';
import { mainMenuKeyboard } from '../keyboards.js';

const GB = 1073741824;

function sanitizeName(raw) {
  return raw.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'Unnamed';
}

const createSubLinkScene = new Scenes.WizardScene(
  'create-sublink',

  async (ctx) => {
    ctx.wizard.state.data = {};
    await ctx.reply('🔤 نام لینک را وارد کنید', { parse_mode: 'Markdown' });
    await ctx.reply(
      'یک نام برای این لینک انتخاب کنید:\n' +
      '🔹 مثال: «گوشی من»، «لپ‌تاپ»، «دستگاه همسرم»\n\n' +
      'تنها حروف و اعداد مجاز است.',
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('لطفاً یک نام معتبر وارد کنید.');
      return;
    }
    ctx.wizard.state.data.name = sanitizeName(ctx.message.text);

    await ctx.reply(
      '📏 محدودیت مصرف را تعیین کنید\n\n' +
      '🔹 `0` : بدون محدودیت (استفاده از کل پهنای باند اشتراک)\n' +
      '🔹 یا عددی مانند `5` = 5 گیگابایت\n\n' +
      'مقدار را به گیگابایت وارد کنید:',
      { parse_mode: 'Markdown' },
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    try {
      const quotaInput = ctx.message?.text?.trim();
      if (!quotaInput || isNaN(Number(quotaInput)) || Number(quotaInput) < 0) {
        await ctx.reply('⚠️ لطفاً یک عدد معتبر وارد کنید.');
        return;
      }

      const quotaGB = Number(quotaInput);
      const allocatedBytes = quotaGB === 0 ? null : quotaGB * GB;

      const user = await UserService.resolveUser(ctx.from.id);
      const sub = await SubscriptionRepository.findOne({
        ownerId: user._id, status: 'active',
      });
      if (!sub) {
        await ctx.reply('❌ اشتراک فعالی ندارید. ابتدا یک طرح خریداری کنید.');
        return ctx.scene.leave();
      }

      const config = await TunnelService.createSubLink(
        sub._id, ctx.wizard.state.data.name, allocatedBytes, false,
      );

      await ctx.replyWithMarkdown(
        '✅ لینک ساخته شد\n\n' +
        `🔹 نام: \`${config.name}\`\n` +
        `🔹 UUID: \`${config.uuid}\`\n` +
        `🔹 حجم: ${formatBytes(config.allocatedQuotaBytes)}\n` +
        `🔹 وضعیت: ${config.isActive ? '✅ فعال' : '❌ غیرفعال'}`,
      );

      await ctx.replyWithMarkdown('📋 منوی اصلی\n\nلطفاً یک گزینه را انتخاب کنید:', mainMenuKeyboard);
    } catch (error) {
      await ctx.reply(formatError(error));
      await ctx.replyWithMarkdown('📋 منوی اصلی\n\nلطفاً یک گزینه را انتخاب کنید:', mainMenuKeyboard);
    }

    return ctx.scene.leave();
  },
);

export default createSubLinkScene;
