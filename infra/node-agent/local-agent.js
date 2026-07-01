/**
 * HORNET Local Node Agent (rootless, for local/dev testing)
 *
 * Purpose
 * -------
 * A lightweight agent that runs on the SAME machine as a locally-installed Xray
 * and lets the (Dockerised) backend provision users into it — without sudo,
 * systemd, or root-owned config paths that the production `agent.js` assumes.
 *
 * Command delivery
 * ----------------
 * The backend queues node commands as PendingNodeCommand docs and hands them
 * back INSIDE the heartbeat response (see NodeCommandService.executeNodeCommand
 * + NodeHealthService.processHeartbeat). So this agent simply:
 *   1. POSTs a signed heartbeat to /api/nodes/heartbeat every N seconds,
 *   2. executes any commands returned in `data.commands` (create/remove user)
 *      LIVE via Xray's gRPC HandlerService (127.0.0.1:10085),
 *   3. reports each result back to /api/nodes/command-result.
 *
 * Prereqs: a Server row must exist in Mongo with this nodeToken
 * (scripts/seed-local-node.mjs) and Xray must be running with a gRPC API inbound
 * on `xrayApiAddr` plus an inbound tagged `inboundTag`.
 *
 * Usage: node local-agent.js [--config ./local-agent.config.json]
 */
import fs from 'fs';
import crypto from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import XrayGrpcManager from './services/XrayGrpcManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : resolve(__dirname, 'local-agent.config.json');

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const {
  backendUrl,
  nodeToken,
  xrayApiAddr = '127.0.0.1:10085',
  inboundTag = 'vless-in',
  protocol = 'vless',
  heartbeatIntervalSec = 10,
} = cfg;

let serverId = null;

function log(level, msg, data) {
  const ts = new Date().toISOString();
  const line = `${ts} [local-agent] ${level.toUpperCase()} ${msg}`;
  if (data !== undefined) console.log(line, data);
  else console.log(line);
}

// ── Xray gRPC ───────────────────────────────────────────────────────────────
const xray = new XrayGrpcManager(xrayApiAddr);
let xrayReady = false;

async function ensureXray() {
  if (xrayReady) return;
  await xray.connect();
  xrayReady = true;
  log('info', `Connected to Xray gRPC at ${xrayApiAddr}`);
}

// ── Signed requests (HMAC matches middlewares/nodeAuth.js) ────────────────────
function signedHeaders(method, path, bodyStr) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = `${timestamp}.${nonce}.${method}.${path}.${bodyStr}`;
  const signature = crypto.createHmac('sha256', nodeToken).update(payload).digest('hex');
  return {
    'Content-Type': 'application/json',
    'x-node-token': nodeToken,
    'x-node-timestamp': timestamp,
    'x-node-nonce': nonce,
    'x-node-signature': signature,
  };
}

async function postSigned(path, bodyObj) {
  const bodyStr = JSON.stringify(bodyObj);
  const res = await fetch(`${backendUrl}${path}`, {
    method: 'POST',
    headers: signedHeaders('POST', path, bodyStr),
    body: bodyStr,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json };
}

// ── Command execution ─────────────────────────────────────────────────────────
async function executeCommand(cmd) {
  const { id, type } = cmd;
  log('info', `Command received: ${type}`, cmd);
  try {
    await ensureXray();
    switch (type) {
      case 'create_user': {
        const email = cmd.email || `user-${cmd.uuid}@hornet.node`;
        await xray.addUser(inboundTag, email, protocol, cmd.uuid);
        log('info', `User provisioned into Xray: ${email}`);
        break;
      }
      case 'remove_user':
      case 'disable_user': {
        if (cmd.email) await xray.removeUser(inboundTag, cmd.email);
        log('info', `User removed from Xray: ${cmd.email}`);
        break;
      }
      case 'restart_xray':
      case 'update_config':
      case 'sync_users':
        // No-op for the local rootless agent (users managed live via gRPC).
        break;
      default:
        log('warn', `Unknown command type: ${type}`);
    }
    await postSigned('/api/nodes/command-result', { serverId, commandId: id, status: 'completed' });
  } catch (err) {
    log('error', `Command ${type} failed: ${err.message}`);
    xrayReady = false; // reopen the gRPC channel next time
    await postSigned('/api/nodes/command-result', { serverId, commandId: id, status: 'failed', error: err.message })
      .catch(() => {});
  }
}

// ── Heartbeat + command poll ──────────────────────────────────────────────────
async function heartbeatTick() {
  try {
    const { ok, status, json } = await postSigned('/api/nodes/heartbeat', { nodeToken });
    if (!ok) { log('warn', `Heartbeat HTTP ${status}`); return; }
    const data = json?.data || {};
    if (data.serverId) serverId = data.serverId;
    const commands = Array.isArray(data.commands) ? data.commands : [];
    for (const cmd of commands) {
      await executeCommand(cmd);
    }
  } catch (err) {
    log('warn', `Heartbeat failed: ${err.message}`);
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  log('info', 'Starting HORNET local agent', { backendUrl, inboundTag, protocol, heartbeatIntervalSec });
  await ensureXray().catch((e) => log('error', `Initial Xray connect failed: ${e.message}`));
  await heartbeatTick();
  setInterval(heartbeatTick, heartbeatIntervalSec * 1000);
})();

process.on('SIGINT', () => { xray.close(); process.exit(0); });
process.on('SIGTERM', () => { xray.close(); process.exit(0); });
