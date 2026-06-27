import { Scenes } from 'telegraf';

const createSubLinkScene = new Scenes.BaseScene('createSubLinkScene');

createSubLinkScene.enter(async (ctx) => {
  await ctx.msgQueue.sendMessage(ctx.chat.id, '🔗 Create Sub-link\n\nEnter name:');
});

createSubLinkScene.on('text', async (ctx) => {
  const name = ctx.message.text;
  const Subscription = (await import('../../models/Subscription.js')).default;
  
  // Create sub-link logic here
  await ctx.msgQueue.sendMessage(ctx.chat.id, `✅ Sub-link "${name}" created`);
  await ctx.scene.leave();
});

export default createSubLinkScene;
