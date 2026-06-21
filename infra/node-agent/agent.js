/**
 * HORNET Node Agent
 * Runs on each VPS node. Registers with central backend,
 * reports health metrics, executes commands, manages XRay.
 *
 * Usage: node agent.js [--config /path/to/config.json]
 */
import fs from 'fs';
import { execSync, exec } from 'child_process';
import { homedir, hostname } from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fetch;
try { fetch = (await import('node-fetch')).default; } catch { fetch = globalThis.fetch; }

// ============== CONFIG ==============
const CONFIG_PATH = process.argv.find(a => a.startsWith('--config'))
  ? process.argv[process.argv.indexOf('--config') + 1]
  : resolve(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {
      backendUrl: process.env.BACKEND_URL || 'http://localhost:3000',
      nodeToken: process.env.NODE_TOKEN || '',
      region: process.env.REGION || 'dev',
      interface: process.env.INTERFACE || 'eth0',
      heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30'),
      metricsInterval: parseInt(process.env.METRICS_INTERVAL || '60'),
      logLevel: process.env.LOG_LEVEL || 'info',
    };
  }
}

const config = loadConfig();
const LOG_PREFIX = `[HORNET-AGENT:${hostname()}]`;

function log(level, msg, data = {}) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  if (levels[level] > (levels[config.logLevel] || 2)) return;
  const ts = new Date().toISOString();
  const line = `${ts} ${LOG_PREFIX} ${level.toUpperCase()} ${msg}`;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](line, Object.keys(data).length ? data : '');
}

// ============== XRay Management ==============
const XRAY_API = `http://127.0.0.1:${process.env.XRAY_API_PORT || '10085'}`;
const XRAY_CONFIG = '/usr/local/etc/xray/config.json';

async function callXrayApi(method, path, body = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${XRAY_API}${path}`, opts);
    if (!res.ok) throw new Error(`XRay API error: ${res.status} ${res.statusText}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    log('error', 'XRay API call failed', { method, path, error: err.message });
    return null;
  }
}

function readXrayConfig() {
  try {
    return JSON.parse(fs.readFileSync(XRAY_CONFIG, 'utf-8'));
  } catch { return null; }
}

function writeXrayConfig(config) {
  fs.writeFileSync(XRAY_CONFIG, JSON.stringify(config, null, 2));
}

async function restartXray() {
  return new Promise((resolve, reject) => {
    exec('systemctl restart xray', (err, stdout, stderr) => {
      if (err) { log('error', 'Failed to restart xray', { stderr }); reject(err); }
      else { log('info', 'XRay restarted successfully'); resolve(stdout); }
    });
  });
}

async function getXrayStatus() {
  return new Promise((resolve) => {
    exec('systemctl is-active xray', (err, stdout) => {
      resolve(err ? 'inactive' : stdout.trim());
    });
  });
}

async function createXrayUser(uuid, email, trafficLimitGB = null, expiryDays = null) {
  const xc = readXrayConfig();
  if (!xc || !xc.inbounds) { log('error', 'Cannot read XRay config'); return null; }

  const client = { id: uuid, email };
  if (trafficLimitGB) client.totalGB = trafficLimitGB;
  if (expiryDays) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + expiryDays);
    client.expiryTime = expiry.toISOString();
  }

  for (const inbound of xc.inbounds) {
    if (!inbound.settings?.clients) continue;
    const exists = inbound.settings.clients.find(c => c.email === email);
    if (!exists) {
      inbound.settings.clients.push({ ...client });
    }
  }

  writeXrayConfig(xc);
  await restartXray();
  log('info', 'XRay user created', { uuid, email });
  return client;
}

async function removeXrayUser(email) {
  const xc = readXrayConfig();
  if (!xc || !xc.inbounds) { log('error', 'Cannot read XRay config'); return null; }

  let removed = false;
  for (const inbound of xc.inbounds) {
    if (!inbound.settings?.clients) continue;
    const before = inbound.settings.clients.length;
    inbound.settings.clients = inbound.settings.clients.filter(c => c.email !== email);
    if (inbound.settings.clients.length !== before) removed = true;
  }

  if (removed) {
    writeXrayConfig(xc);
    await restartXray();
    log('info', 'XRay user removed', { email });
  }
  return { removed };
}

async function listXrayUsers() {
  const xc = readXrayConfig();
  if (!xc || !xc.inbounds) return [];
  const users = [];
  for (const inbound of xc.inbounds) {
    if (inbound.settings?.clients) {
      users.push(...inbound.settings.clients.map(c => ({ ...c, inboundTag: inbound.tag, port: inbound.port, protocol: inbound.protocol })));
    }
  }
  return users;
}

async function disableXrayUser(email) {
  const xc = readXrayConfig();
  if (!xc || !xc.inbounds) return null;
  for (const inbound of xc.inbounds) {
    if (!inbound.settings?.clients) continue;
    const client = inbound.settings.clients.find(c => c.email === email);
    if (client) client.enable = false;
  }
  writeXrayConfig(xc);
  await restartXray();
  log('info', 'XRay user disabled', { email });
  return { disabled: true };
}

// ============== Health Metrics ==============
function getSystemMetrics() {
  try {
    const cpu = parseFloat(execSync("top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4}'", { encoding: 'utf-8' }).trim()) || 0;
    const memTotal = parseInt(execSync("free -b | awk '/^Mem:/{print $2}'", { encoding: 'utf-8' }).trim()) || 0;
    const memAvailable = parseInt(execSync("free -b | awk '/^Mem:/{print $7}'", { encoding: 'utf-8' }).trim()) || 0;
    const diskTotal = parseInt(execSync("df -B1 / | awk 'NR==2{print $2}'", { encoding: 'utf-8' }).trim()) || 0;
    const diskUsed = parseInt(execSync("df -B1 / | awk 'NR==2{print $3}'", { encoding: 'utf-8' }).trim()) || 0;
    const uptime = parseFloat(execSync('cat /proc/uptime | awk "{print $1}"', { encoding: 'utf-8' }).trim()) || 0;
    const loadAvg = execSync("cat /proc/loadavg | awk '{print $1,$2,$3}'", { encoding: 'utf-8' }).trim();

    let rxBytes = 0, txBytes = 0;
    try {
      const netStats = fs.readFileSync(`/sys/class/net/${config.interface}/statistics/rx_bytes`, 'utf-8');
      rxBytes = parseInt(netStats.trim()) || 0;
      const txStats = fs.readFileSync(`/sys/class/net/${config.interface}/statistics/tx_bytes`, 'utf-8');
      txBytes = parseInt(txStats.trim()) || 0;
    } catch { /* interface not found */ }

    return {
      cpuPercent: Math.round(cpu * 10) / 10,
      memoryBytes: { total: memTotal, available: memAvailable, used: memTotal - memAvailable },
      memoryPercent: memTotal > 0 ? Math.round(((memTotal - memAvailable) / memTotal) * 1000) / 10 : 0,
      diskBytes: { total: diskTotal, used: diskUsed, free: diskTotal - diskUsed },
      diskPercent: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 1000) / 10 : 0,
      networkBytes: { rxBytes, txBytes },
      loadAvg: loadAvg.split(' ').map(Number),
      uptimeSeconds: uptime,
    };
  } catch (err) {
    log('error', 'Failed to collect system metrics', { error: err.message });
    return null;
  }
}

function getXrayMetrics() {
  try {
    const logFile = '/var/log/xray/access.log';
    if (!fs.existsSync(logFile)) return { activeConnections: 0, trafficToday: 0 };
    const lines = execSync(`tail -100 ${logFile} 2>/dev/null | wc -l`, { encoding: 'utf-8' }).trim();
    return { activeConnections: parseInt(lines) || 0 };
  } catch {
    return { activeConnections: 0, trafficToday: 0 };
  }
}

// ============== Backend Communication ==============
let registered = false;
let serverId = null;
let lastMetrics = null;

function signRequest(method, path, body, timestamp, nonce) {
  const payload = `${timestamp}.${nonce}.${method}.${path}.${JSON.stringify(body || {})}`;
  return crypto.createHmac('sha256', config.nodeToken).update(payload).digest('hex');
}

async function apiRequest(method, path, body = null) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = signRequest(method, path, body, timestamp, nonce);
  const headers = {
    'Content-Type': 'application/json',
    'X-Node-Token': config.nodeToken,
    'X-Node-Signature': signature,
    'X-Node-Timestamp': timestamp,
    'X-Node-Nonce': nonce,
    'X-Node-Hostname': hostname(),
  };

  try {
    const res = await fetch(`${config.backendUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      timeout: 15000,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      log('warn', 'Backend request failed', { path, status: res.status, error: data.error });
      return null;
    }
    return data;
  } catch (err) {
    log('error', 'Backend request error', { path, error: err.message });
    return null;
  }
}

async function sendHeartbeat() {
  const metrics = getSystemMetrics();
  const xrayMetrics = getXrayMetrics();
  const xrayStatus = await getXrayStatus();

  if (!metrics) return;

  lastMetrics = {
    ...metrics,
    xrayStatus,
    activeConnections: xrayMetrics.activeConnections,
    timestamp: new Date().toISOString(),
  };

  const result = await apiRequest('POST', '/api/nodes/heartbeat', {
    nodeToken: config.nodeToken,
    serverId,
    metrics: lastMetrics,
  });

  if (result?.success && result.data?.serverId) {
    if (!registered) {
      registered = true;
      serverId = result.data.serverId;
      log('info', 'Node registered with backend', { serverId });
    }
    if (result.data?.commands && Array.isArray(result.data.commands)) {
      for (const cmd of result.data.commands) {
        await executeCommand(cmd);
      }
    }
  }
}

async function executeCommand(command) {
  log('info', 'Executing remote command', { command: command.type });

  try {
    switch (command.type) {
      case 'create_user':
        await createXrayUser(command.uuid, command.email, command.trafficLimitGB, command.expiryDays);
        break;
      case 'remove_user':
        await removeXrayUser(command.email);
        break;
      case 'disable_user':
        await disableXrayUser(command.email);
        break;
      case 'restart_xray':
        await restartXray();
        break;
      case 'update_config':
        if (command.config) {
          writeXrayConfig(command.config);
          await restartXray();
        }
        break;
      case 'sync_users': {
        const currentUsers = await listXrayUsers();
        const result = await apiRequest('POST', '/api/nodes/sync-users', {
          serverId,
          users: currentUsers,
        });
        if (result?.data?.toCreate) {
          for (const u of result.data.toCreate) {
            await createXrayUser(u.uuid, u.email, u.trafficLimitGB, u.expiryDays);
          }
        }
        if (result?.data?.toRemove) {
          for (const email of result.data.toRemove) {
            await removeXrayUser(email);
          }
        }
        break;
      }
      default:
        log('warn', 'Unknown command type', { type: command.type });
    }

    await apiRequest('POST', '/api/nodes/command-result', {
      serverId, commandId: command.id, status: 'completed',
    });
  } catch (err) {
    log('error', 'Command execution failed', { type: command.type, error: err.message });
    await apiRequest('POST', '/api/nodes/command-result', {
      serverId, commandId: command.id, status: 'failed', error: err.message,
    });
  }
}

// ============== Startup Registration ==============
async function registerSelf() {
  log('info', 'Attempting to register with backend', { url: config.backendUrl });

  const ip = execSync("curl -4 -fsSL ifconfig.me 2>/dev/null || echo '127.0.0.1'", { encoding: 'utf-8' }).trim();
  const xrayStatus = await getXrayStatus();

  const result = await apiRequest('POST', '/api/nodes/register', {
    name: hostname(),
    ipAddress: ip,
    region: config.region,
    port: 443,
    xrayApiPort: parseInt(process.env.XRAY_API_PORT || '10085'),
    maxCapacity: 200,
    nodeToken: config.nodeToken,
    xrayStatus,
  });

  if (result?.success && result.data?.serverId) {
    registered = true;
    serverId = result.data.serverId;
    log('info', 'Node registered', { serverId });
  } else {
    log('warn', 'Registration failed, will retry via heartbeat');
  }
}

// ============== Main Loop ==============
async function main() {
  log('info', 'Starting HORNET Node Agent', {
    backend: config.backendUrl,
    region: config.region,
    heartbeatInterval: config.heartbeatInterval,
  });

  // Initial registration
  await registerSelf();

  // Periodic heartbeat
  setInterval(sendHeartbeat, config.heartbeatInterval * 1000);

  // Periodic metrics collection
  setInterval(async () => {
    const metrics = getSystemMetrics();
    if (metrics) log('debug', 'System metrics', { cpu: metrics.cpuPercent + '%', mem: metrics.memoryPercent + '%', disk: metrics.diskPercent + '%' });
  }, config.metricsInterval * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    log('info', 'Agent shutting down...');
    await apiRequest('POST', '/api/nodes/shutdown', { serverId, nodeToken: config.nodeToken });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  log('error', 'Agent fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
