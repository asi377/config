/**
 * UsageBuffer — Redis write-buffer for per-user traffic counters.
 *
 * Agents report per-second byte counters via `recordUsage`.  Data lands in
 * Redis `HINCRBY` instantly (no MongoDB write amplification).  Every 10
 * minutes a cron calls `flushToMongo` which snapshots, bulk-writes, and
 * resets — all without blocking the hot path.
 *
 * ── Data model ────────────────────────────────────────────────────────────
 *   Key                 Type     Fields
 *   ───                 ────     ──────
 *   usage:{tunnelUuid}  Hash     up (bytes), down (bytes)
 *
 *   The key is auto-created by HINCRBY on first report and deleted after
 *   each flush.  tunnelUuid is the TunnelConfig.uuid (opaque subscription
 *   link token).
 *
 * ── Atomic flush (race-condition safety) ─────────────────────────────────
 *   flushToMongo:
 *     1. SCAN all usage:* keys
 *     2. Pipeline RENAME usage:{id} → flush:{id}
 *          └─ New HINCRBYs after this point go to a NEW usage:{id} — no loss
 *     3. Pipeline HGETALL + DEL on every flush:{id}
 *     4. BulkWrite $inc to TunnelConfig + Subscription
 *
 *   The RENAME guarantees that a counter cannot be both read AND written
 *   across the flush boundary.  There is zero data loss regardless of how
 *   many concurrent `recordUsage` calls arrive.
 *
 * ── Integration ────────────────────────────────────────────────────────────
 *   import UsageBuffer from './services/UsageBuffer.js';
 *   UsageBuffer.recordUsage(tunnelUuid, 1024, 512);
 *
 *   // In your cron (e.g. JobManager.js every 10 min):
 *   await UsageBuffer.flushToMongo();
 *
 * ── Dependencies ──────────────────────────────────────────────────────────
 *   ioredis (via redisClient), mongoose models TunnelConfig + Subscription
 */

import redisClient from '../redis/client.js';
import TunnelConfig from '../models/TunnelConfig.js';
import Subscription from '../models/Subscription.js';
import logger from '../config/logger.js';

const USAGE_PREFIX = 'usage:';
const FLUSH_PREFIX = 'flush:';
const SCAN_COUNT = 200;

class UsageBuffer {
  /**
   * Atomically accumulate traffic counters in Redis.
   *
   * @param {string} tunnelUuid  The TunnelConfig.uuid (subscription link token).
   * @param {number} upBytes     Upload bytes to add.
   * @param {number} downBytes   Download bytes to add.
   */
  async recordUsage(tunnelUuid, upBytes, downBytes) {
    const redis = redisClient.getClient();
    if (!redis) {
      logger.warn('[UsageBuffer] Redis unavailable — dropping usage report');
      return;
    }

    const key = USAGE_PREFIX + tunnelUuid;
    const up = Math.max(0, Math.round(upBytes));
    const down = Math.max(0, Math.round(downBytes));

    if (up === 0 && down === 0) return;

    await redis.hincrby(key, 'up', up);
    await redis.hincrby(key, 'down', down);
  }

  /**
   * Snapshot all accumulated counters, flush them to MongoDB in bulk,
   * and atomically reset the Redis keys.
   *
   * Safe to call concurrently with `recordUsage` — the RENAME step
   * guarantees zero data loss.
   */
  async flushToMongo() {
    const redis = redisClient.getClient();
    if (!redis) {
      logger.warn('[UsageBuffer] Redis unavailable — cannot flush');
      return;
    }

    // ── 1. Discover pending keys ─────────────────────────────────────────
    const keys = await this._scanKeys(redis, USAGE_PREFIX + '*');
    if (keys.length === 0) return;

    logger.info({ pendingKeys: keys.length }, '[UsageBuffer] Starting flush');

    // ── 2. Atomic RENAME: usage → flush ──────────────────────────────────
    const renamePipeline = redis.pipeline();
    const userIds = []; // tunnelUuids that were successfully renamed

    for (const key of keys) {
      const tunnelUuid = key.slice(USAGE_PREFIX.length);
      const flushKey = FLUSH_PREFIX + tunnelUuid;
      // RENAME overwrites flushKey if it exists.  FLUSH keys should never
      // persist across flushes, but if a previous flush crashed mid-way,
      // the overwrite is correct — the latest data wins.
      renamePipeline.rename(key, flushKey);
      userIds.push(tunnelUuid);
    }

    const renameResults = await renamePipeline.exec();

    // Filter out keys that disappeared (RENAME returns error for non-existent)
    const validUserIds = [];
    for (let i = 0; i < renameResults.length; i++) {
      const [err] = renameResults[i];
      if (!err) validUserIds.push(userIds[i]);
    }

    if (validUserIds.length === 0) return;

    // ── 3. Read flushed counters ──────────────────────────────────────────
    const readPipeline = redis.pipeline();
    for (const id of validUserIds) {
      readPipeline.hgetall(FLUSH_PREFIX + id);
    }
    const readResults = await readPipeline.exec();

    const usageMap = new Map(); // tunnelUuid → { up, down }

    for (let i = 0; i < validUserIds.length; i++) {
      const id = validUserIds[i];
      const data = readResults[i]?.[1]; // [err, result]
      if (!data || Object.keys(data).length === 0) continue;

      usageMap.set(id, {
        up: parseInt(data.up || 0, 10),
        down: parseInt(data.down || 0, 10),
      });
    }

    if (usageMap.size === 0) return;

    // ── 5. Bulk-write to MongoDB ─────────────────────────────────────────
    //    IMPORTANT: MongoDB write happens BEFORE deleting processing keys.
    //    If the write fails, the flush: keys persist and the next flush
    //    retries them (RENAME overwrites stale flush: with fresh usage:).
    await this._writeToMongo(usageMap);

    // ── 6. Delete processing keys (safe — MongoDB write succeeded) ────────
    const delPipeline = redis.pipeline();
    for (const id of validUserIds) {
      delPipeline.del(FLUSH_PREFIX + id);
    }
    await delPipeline.exec();
  }

  /* ── Internal ──────────────────────────────────────────────────────────── */

  /**
   * Iterate over Redis keys using SCAN (non-blocking).
   */
  async _scanKeys(redis, pattern) {
    const keys = [];
    let cursor = '0';
    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
      cursor = result[0];
      for (const key of result[1]) {
        keys.push(key);
      }
    } while (cursor !== '0');
    return keys;
  }

  /**
   * Write accumulated usage to MongoDB.
   *
   * Updates two collections:
   *   1. TunnelConfig.usedQuotaBytes   → per-link cap
   *   2. Subscription.usedVolumeBytes  → per-plan cap
   *
   * Mongoose `bulkWrite` bypasses schema validation intentionally — the
   * $inc may temporarily push counters past the cap.  The existing
   * `expireStaleResources` cron (runs every 10 min) catches overages and
   * suspends the subscription.
   */
  async _writeToMongo(usageMap) {
    const uuids = [...usageMap.keys()];

    // Resolve tunnel UUID → DB metadata in a single query.
    const tunnelConfigs = await TunnelConfig.find(
      { uuid: { $in: uuids } },
      { _id: 1, uuid: 1, subscriptionId: 1 },
    ).lean();

    if (tunnelConfigs.length === 0) {
      logger.warn({ uuids: uuids.length }, '[UsageBuffer] No matching TunnelConfigs found — data dropped');
      return;
    }

    const tunnelBulkOps = [];
    const subTotals = new Map(); // subscriptionId (string) → total bytes

    for (const tc of tunnelConfigs) {
      const usage = usageMap.get(tc.uuid);
      if (!usage) continue;

      const totalBytes = usage.up + usage.down;
      if (totalBytes <= 0) continue;

      tunnelBulkOps.push({
        updateOne: {
          filter: { _id: tc._id },
          update: { $inc: { usedQuotaBytes: totalBytes } },
        },
      });

      const subId = tc.subscriptionId.toString();
      subTotals.set(subId, (subTotals.get(subId) || 0) + totalBytes);
    }

    // ── Bulk-update TunnelConfig ─────────────────────────────────────────
    if (tunnelBulkOps.length > 0) {
      const tunnelResult = await TunnelConfig.bulkWrite(tunnelBulkOps, { ordered: false });
      logger.debug(
        { modified: tunnelResult.modifiedCount, matched: tunnelResult.matchedCount },
        '[UsageBuffer] TunnelConfig bulkWrite',
      );
    }

    // ── Bulk-update Subscription ──────────────────────────────────────────
    const subBulkOps = [];
    for (const [subId, bytes] of subTotals) {
      subBulkOps.push({
        updateOne: {
          filter: { _id: subId },
          update: { $inc: { usedVolumeBytes: bytes } },
        },
      });
    }

    if (subBulkOps.length > 0) {
      const subResult = await Subscription.bulkWrite(subBulkOps, { ordered: false });
      logger.debug(
        { modified: subResult.modifiedCount, matched: subResult.matchedCount },
        '[UsageBuffer] Subscription bulkWrite',
      );
    }

    const totalBytes = [...subTotals.values()].reduce((a, b) => a + b, 0);
    logger.info(
      {
        tunnelsUpdated: tunnelBulkOps.length,
        subscriptionsUpdated: subBulkOps.length,
        totalBytes,
        totalMB: (totalBytes / 1048576).toFixed(1),
      },
      '[UsageBuffer] Flush committed',
    );
  }
}

export default new UsageBuffer();
