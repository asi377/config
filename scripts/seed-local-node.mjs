/**
 * Seed / upsert a LOCAL test node (Server row) so the free-trial + paid-config
 * flows can provision against a local rootless Xray during development.
 *
 * The nodeToken here must match infra/node-agent/local-agent.config.json and the
 * Reality/plain params must match /home/asi37/hornet-node/xray-config.json.
 *
 * Run inside the backend container (has MONGO_URI + models):
 *   docker compose exec -T backend node scripts/seed-local-node.mjs
 */
import mongoose from 'mongoose';
import config from '../src/config/index.js';
import Server from '../src/models/Server.js';

const NODE_TOKEN = process.env.LOCAL_NODE_TOKEN
  || '60824b8e1b8ae590c527920f484889c112fcbbb552b4f1466854d5269048a685';
const NODE_IP = process.env.LOCAL_NODE_IP || '172.23.108.110';
const NODE_PORT = parseInt(process.env.LOCAL_NODE_PORT || '8443', 10);

async function main() {
  await mongoose.connect(config.mongoUri);
  const res = await Server.updateOne(
    { nodeToken: NODE_TOKEN },
    {
      $set: {
        name: 'LOCAL-TEST-1',
        region: 'local',
        country: 'IR',
        ipAddress: NODE_IP,
        port: NODE_PORT,
        xrayApiPort: 10085,
        maxCapacity: 100,
        status: 'active',
        healthStatus: 'healthy',
        healthy: true,
        salesEnabled: true,
        nodeToken: NODE_TOKEN,
        lastHeartbeat: new Date(),
        // Transport the local Xray actually serves (plain VLESS-TCP for dev).
        metadata: { inboundTag: 'vless-in', security: 'none', network: 'tcp', flow: '' },
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  const s = await Server.findOne({ nodeToken: NODE_TOKEN }).lean();
  console.log('[seed-local-node] upserted:', JSON.stringify(res));
  console.log('[seed-local-node] serverId:', String(s._id), '→', s.ipAddress + ':' + s.port, s.status);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
