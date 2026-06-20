import { Scenes, Markup } from 'telegraf';
import { Plan, Setting, User, Receipt } from '../models/index.js';
import paymentService from '../services/PaymentService.js';

async function resolveUser(telegramId) {
  let user = await User.findOne({ telegramId });
  if (!user) {
    user = await User.create({ telegramId });
  }
  return user;
}

async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err?.description?.includes('message is not modified')) return;
    throw err;
  }
}

function formatError(error) {
  return '❌ خطایی رخ داد. دوباره تلاش کنید یا با پشتیبانی ملکه تماس بگیرید.';
}

function formatRials(amount) {
  return `${amount.toLocaleString()} ریال`;
}

async function showMainMenu(ctx, prefix) {
  const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🏠 کندوی من', 'my_subscriptions')],
    [Markup.button.callback('⚡ ارتقاء بال‌ها', 'buy_renew')],
    [Markup.button.callback('🎁 هدیه شهد', 'free_trial')],
    [Markup.button.callback('📊 وضعیت پرواز', 'profile')],
  ]);

  const msg = prefix ?? '🐝 *HORNET NEST*';
  if (ctx.callbackQuery) {
    await safeEdit(ctx, msg, { parse_mode: 'Markdown', ...mainMenuKeyboard });
  } else {
    await ctx.replyWithMarkdown(msg, mainMenuKeyboard);
  }
}

const receiptUploadScene = new Scenes.WizardScene(
  'receipt-upload',

  async (ctx) => {
    ctx.wizard.state.data = ctx.scene.state || {};
    const planId = ctx.wizard.state.data?.planId;
    const plan = planId ? await Plan.findById(planId).lean() : null;

    const cardNumber = await Setting.get('cardNumber', '۵۰۲۲-۲۹۱۰-XXXX-XXXX');

    const lines = [
      '💳 *پرداخت کارت به کارت*',
      '',
      '🔹 مشخصات کارت برای واریز:',
      '',
      `💳 شماره کارت: \`${cardNumber}\``,
      plan ? `💰 مبلغ: ${formatRials(plan.basePrice)}` : '💰 مبلغ: دلخواه',
      '',
      '📸 *مرحله اول:*',
      'پس از واریز، عکس رسید را ارسال کنید.',
      'نگهبانان ما پرداخت شما را بررسی می‌کنند.',
      '',
      '⏱ زمان تقریبی: کمتر از ۳۰ دقیقه',
    ];

    await ctx.replyWithMarkdown(lines.join('\n'));
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.photo) {
      await ctx.reply(
        '📸 لطفاً عکس رسید پرداخت خود را ارسال کنید.\n' +
        'می‌توانید از رسید پیامک بانکی عکس بگیرید.',
      );
      return;
    }

    ctx.wizard.state.data.photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await ctx.reply(
      '💰 *مرحله دوم:*\n\n' +
      'مبلغ واریزی را به *تومان* وارد کنید.\n' +
      'مثال: برای ۱,۸۰۰,۰۰۰ ریال، عدد ۱۸۰,۰۰۰ را وارد کنید.',
      { parse_mode: 'Markdown' },
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    try {
      const amountInput = ctx.message?.text?.trim();
      if (!amountInput || isNaN(Number(amountInput)) || Number(amountInput) <= 0) {
        await ctx.reply('⚠️ لطفاً یک عدد معتبر به تومان وارد کنید.');
        return;
      }

      const amount = Number(amountInput) * 10;
      const user = await resolveUser(ctx.from.id);
      const { planId, photoFileId } = ctx.wizard.state.data;

      const receipt = await paymentService.submitReceipt(user._id, planId || null, amount, photoFileId);

      const successLines = [
        '✅ *رسید شما ثبت شد*',
        '',
        '🔹 کد پیگیری: `' + receipt._id + '`',
        '🔹 مبلغ: ' + formatRials(amount),
        '',
        'رسید شما برای بررسی به نگهبانان ارسال شد.',
        'پس از تأیید، مخزن شهد شما شارژ می‌شود.',
      ];

      await ctx.replyWithMarkdown(successLines.join('\n'));

      const adminId = process.env.ADMIN_ID;
      if (adminId && photoFileId) {
        const plan = planId ? await Plan.findById(planId).lean() : null;
        const caption =
          '🐝 *درخواست شارژ جدید*\n\n' +
          '👤 زنبور: `' + user.telegramId + '`\n' +
          '💰 مبلغ: ' + formatRials(amount) + '\n' +
          (plan ? '📦 پلن: ' + plan.title + '\n' : '') +
          '🆔 رسید: `' + receipt._id + '`';

        await ctx.telegram.sendPhoto(adminId, photoFileId, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ تایید', callback_data: 'receipt_approve_' + receipt._id },
                { text: '❌ رد', callback_data: 'receipt_reject_' + receipt._id },
              ],
            ],
          },
        });
      }

      await showMainMenu(ctx);
    } catch (error) {
      await ctx.reply(formatError(error));
      await showMainMenu(ctx);
    }

    return ctx.scene.leave();
  },
);

export default receiptUploadScene;
