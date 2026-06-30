import { Scenes } from 'telegraf';
import { t, SUPPORTED_LANGS } from '../../utils/i18n.js';
import { generateLanguageKeyboard, mainMenuKeyboard } from '../keyboards.js';
import logger from '../../config/logger.js';

const languageScene = new Scenes.BaseScene('languageScene');

languageScene.enter(async (ctx) => {
  await ctx.msgQueue.sendMessage(
    ctx.chat.id,
    t('language_prompt', ctx.lang || 'fa'),
    generateLanguageKeyboard(),
  );
});

languageScene.action(/^set_language_(en|fa|ru)$/, async (ctx) => {
  const newLang = ctx.match[1];

  if (!SUPPORTED_LANGS.includes(newLang)) {
    return ctx.answerCbQuery();
  }

  try {
    if (ctx.user) {
      ctx.user.language = newLang;
      await ctx.user.save();
    }
    ctx.lang = newLang;

    await ctx.answerCbQuery();
    await ctx.editMessageText(t('language_updated', newLang), {
      reply_markup: mainMenuKeyboard(newLang).reply_markup,
    });
  } catch (err) {
    logger.error({ err }, '[bot] languageScene set_language error');
    await ctx.answerCbQuery();
  } finally {
    await ctx.scene.leave();
  }
});

export default languageScene;
