import { Scenes } from 'telegraf';
import PlanRepository from '../../repositories/PlanRepository.js';
import SettingRepository from '../../repositories/SettingRepository.js';
import PaymentService from '../../services/PaymentService.js';
import UserService from '../../services/UserService.js';
import { formatRials, formatError } from '../utils.js';
import { mainMenuKeyboard } from '../keyboards.js';

const receiptUploadScene = new Scenes.WizardScene(
  'receipt-upload',

  async (ctx) => {
    ctx.wizard.state.data = ctx.scene.state || {};
    const planId = ctx.wizard.state.data?.planId;
    const plan = planId ? await PlanRepository.findById(planId) : null;
    const cardNumber = await SettingRepository.get('cardNumber', '5022-2910-XXXX-XXXX');

    const lines = [
      '💳 پرداخت کارت به کارت',
      '',
      'مشخصات کارت برای واریز:',
      '',
      `💳 شماره کارت: \`${cardNumber}\``,
      plan ? `💰 مبلغ: ${formatRials(plan.basePrice)}` : '💰 مبلغ: دلخواه',
      '',
      '📸 مرحله اول:',
      'پس از واریز، تصویر رسید را ارسال کنید.',
      'کارشناسان ما پرداخت شما را بررسی خواهند کرد.',
      '',
      '⏱ زمان تقریبی: کمتر از ۳۰ دقیقه',
    ];

    await ctx.replyWithMarkdown(lines.join('\n'));
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.photo) {
      await ctx.reply('📸 لطفاً تصویر رسید پرداخت خود را ارسال کنید.\nمی‌توانید از رسید پیامک بانکی عکس بگیرید.');
      return;
    }

    ctx.wizard.state.data.photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await ctx.reply(
      '💰 مرحله دوم:\n\n' +
      'مبلغ واریزی را به تومان وارد کنید.\n' +
      '⚠️ تنها عدد وارد کنید (مثال: ۵۰۰۰۰۰)',
      { parse_mode: 'Markdown' },
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    try {
      if (!ctx.message?.text) {
        await ctx.reply('⚠️ لطفاً مبلغ را به عدد وارد کنید.');
        return;
      }

      const cleaned = ctx.message.text.replace(/[،,]/g, '').trim();
      const amount = parseInt(cleaned, 10);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('⚠️ مبلغ معتبر وارد کنید.');
        return;
      }

      const user = await UserService.resolveUser(ctx.from.id);
      const { planId, photoFileId } = ctx.wizard.state.data;

      await PaymentService.submitReceipt(user._id, planId, amount, photoFileId);

      await ctx.replyWithMarkdown(
        '✅ رسید شما با موفقیت ثبت شد\n\n' +
        `💰 مبلغ: ${formatRials(amount)}\n` +
        '⏱ رسید شما توسط کارشناسان بررسی خواهد شد.\n' +
        'حداکثر زمان بررسی: ۳۰ دقیقه',
      );

      await ctx.replyWithMarkdown('📋 منوی اصلی', mainMenuKeyboard);
    } catch (error) {
      await ctx.reply(formatError(error));
      await ctx.replyWithMarkdown('📋 منوی اصلی', mainMenuKeyboard);
    }

    return ctx.scene.leave();
  },
);

export default receiptUploadScene;
