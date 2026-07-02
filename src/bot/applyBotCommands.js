/**
 * Applies the bot's command menu + description to Telegram (the pre-start UI:
 * command list shown by the "/" menu and the "What can this bot do?" text).
 *
 * Source of truth is BotConfig (botCommands / botDescription / botShortDescription),
 * editable from the admin panel; sensible localized defaults are used when unset.
 * Uses raw callApi so the exact Bot API shape is guaranteed across Telegraf versions.
 */
import logger from '../config/logger.js';

const LANGS = ['fa', 'en', 'ru'];

const DEFAULT_COMMANDS = {
  fa: [
    { command: 'start', description: 'شروع' },
    { command: 'menu', description: 'منوی اصلی' },
    { command: 'restart', description: 'شروع مجدد' },
    { command: 'language', description: 'تغییر زبان' },
    { command: 'help', description: 'راهنما' },
  ],
  en: [
    { command: 'start', description: 'Start' },
    { command: 'menu', description: 'Main menu' },
    { command: 'restart', description: 'Restart' },
    { command: 'language', description: 'Change language' },
    { command: 'help', description: 'Help' },
  ],
  ru: [
    { command: 'start', description: 'Старт' },
    { command: 'menu', description: 'Главное меню' },
    { command: 'restart', description: 'Перезапуск' },
    { command: 'language', description: 'Сменить язык' },
    { command: 'help', description: 'Помощь' },
  ],
};

const DEFAULT_DESCRIPTION = {
  fa: 'به HORNET VPN خوش آمدید 🔥 سرعت بالا، امنیت واقعی و دسترسی آزاد. برای شروع /start را بزنید.',
  en: 'Welcome to HORNET VPN 🔥 High speed, real security, free access. Tap /start to begin.',
  ru: 'Добро пожаловать в HORNET VPN 🔥 Высокая скорость и безопасность. Нажмите /start.',
};

export async function applyBotCommands(bot) {
  const BotConfig = (await import('../models/BotConfig.js')).default;
  const cfg = await BotConfig.getSingleton();
  const applied = {};

  for (const lang of LANGS) {
    // Commands (from config if provided, else defaults).
    let commands;
    if (Array.isArray(cfg.botCommands) && cfg.botCommands.length) {
      commands = cfg.botCommands
        .filter((c) => c && c.command)
        .map((c) => ({
          command: String(c.command).replace(/^\//, '').toLowerCase(),
          description: c.description?.[lang] || c.description?.fa || String(c.command),
        }));
    } else {
      commands = DEFAULT_COMMANDS[lang];
    }
    try {
      await bot.telegram.callApi('setMyCommands', { commands, language_code: lang });
      applied[lang] = commands.length;
    } catch (err) {
      logger.warn({ err: err?.message, lang }, '[bot] setMyCommands failed');
    }

    // Long description (the "What can this bot do?" text before /start).
    const desc = cfg.botDescription?.[lang] || DEFAULT_DESCRIPTION[lang];
    if (desc) {
      try { await bot.telegram.callApi('setMyDescription', { description: desc, language_code: lang }); }
      catch (err) { logger.warn({ err: err?.message, lang }, '[bot] setMyDescription failed'); }
    }
    // Short description (profile bio).
    const shortDesc = cfg.botShortDescription?.[lang];
    if (shortDesc) {
      try { await bot.telegram.callApi('setMyShortDescription', { short_description: shortDesc, language_code: lang }); }
      catch (err) { logger.warn({ err: err?.message, lang }, '[bot] setMyShortDescription failed'); }
    }
  }

  // Default (no language_code) fallback = Persian.
  try { await bot.telegram.callApi('setMyCommands', { commands: DEFAULT_COMMANDS.fa }); } catch { /* ignore */ }

  logger.info({ applied }, '[bot] Bot commands + description applied');
  return applied;
}
