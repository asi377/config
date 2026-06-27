import { Scenes } from 'telegraf';
import logger from '../../config/logger.js';

const receiptUploadScene = new Scenes.BaseScene('receiptUploadScene');

receiptUploadScene.enter(async (ctx) => {
  await ctx.msgQueue.sendMessage(
    ctx.chat.id,
    '📸 Upload receipt photo (screenshot of successful transfer)'
  );
});

receiptUploadScene.on('photo', async (ctx) => {
  try {
    const Receipt = (await import('../../models/Receipt.js')).default;
    const User = (await import('../../models/User.js')).default;
    
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    await Receipt.create({
      userId: user._id,
      photoFileId: fileId,
      amount: ctx.session.planAmount || 0,
      status: 'pending',
    });

    await ctx.msgQueue.sendMessage(
      ctx.chat.id,
      '✅ Receipt submitted for review. You will be notified once verified.'
    );
    await ctx.scene.leave();
  } catch (err) {
    logger.error({ err }, '[bot] receiptUploadScene error');
    await ctx.reply('❌ Error uploading receipt');
  }
});

export default receiptUploadScene;
