import logger from '../../config/logger.js';
import BullMQManager from '../../queue/bullmq.js';
import wsServer from './WSServer.js';

const QUEUE_NAME = 'node-commands';

/**
 * Bridge between BullMQ's `node-commands` queue and the WebSocket server.
 *
 * When a job is enqueued (e.g. by NodeCommandService.executeNodeCommand),
 * this worker picks it up, dispatches it to the target node via WSServer,
 * and marks the job as completed/failed based on the agent's ack.
 *
 * Start:  npm run start  (called from app.js after queues are created)
 */
export function startNodeCommandWorker() {
  if (!BullMQManager.queues.has(QUEUE_NAME)) {
    logger.warn('[NodeCommandBridge] Queue not created yet — worker not started');
    return;
  }

  BullMQManager.registerHandler(QUEUE_NAME, async (data, { jobId, name }) => {
    const { serverId, commandName, params } = data;

    if (!serverId || !commandName) {
      throw new Error(`Invalid job data: missing serverId or commandName (job ${jobId})`);
    }

    logger.info({ jobId, serverId, command: commandName }, '[NodeCommandBridge] Dispatching via WebSocket');

    try {
      const ack = await wsServer.dispatchTaskToNode(
        serverId,
        commandName,
        params ?? {},
        30_000,
      );
      logger.info({ jobId, serverId, command: commandName }, '[NodeCommandBridge] Command acknowledged');
      return ack;
    } catch (err) {
      logger.error({ err, jobId, serverId, command: commandName }, '[NodeCommandBridge] Command failed');
      throw err; // BullMQ will retry according to the queue's attempts setting
    }
  }, { concurrency: 10 });

  logger.info('[NodeCommandBridge] Worker started for node-commands queue');
}
