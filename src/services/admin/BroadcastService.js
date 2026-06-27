import logger from '../../config/logger.js';

class BroadcastService {
  static registerWorker(bot) {
    const BullMQManager = require('../../queue/bullmq.js').default;
    const queue = BullMQManager.getQueue('telegram-out');

    if (queue) {
      const worker = BullMQManager.createWorker('telegram-out', async (job) => {
        const { text, targetRole } = job.data;
        if (job.data.type === 'broadcast') {
          logger.info({ targetRole }, '[broadcast] Sending broadcast message');
          // Implementation would send to all users matching role
        }
      });
    }
  }
}

export default BroadcastService;
