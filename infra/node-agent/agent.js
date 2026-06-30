/**
 * HORNET Node Agent — Secure Edition
 *
 * Changes from v1:
 *  - Removes systemctl restart on every user update (uses SIGHUP reload for zero-downtime)
 *  - Atomic file writes (write to temp, rename) to prevent config.json corruption
 *  - Concurrency lock (in-memory mutex) for parallel execution safety
 *  - Graceful degradation: SIGHUP → systemctl reload → systemctl restart (last resort)
 *  - No more execSync for metrics (uses /proc directly via fs.readFileSync where possible)
 *
 * Usage: node agent.js [--config /path/to/config.json]
 */
import fs from 'fs';
import { exec, execSync } from 'child_process';
import { hostname } from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fetch;
try {
  fetch = (await import('node-fetch')).default;
} catch {
  fetch = globalThis.fetch;
}

// ─── Config ───────────────────────────────────────────────────────────────
const CONFIG_PATH = process.argv.find(a => a.startsWith('--config'))
  ? process.argv[process.argv.indexOf('--config') + 1]
  : resolve(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {
      backendUrl:        process.env.BACKEND_URL || 'http://localhost:3000',
      nodeToken:         process.env.NODE_TOKEN || '',
      region:            process.env.REGION || 'dev',
      interface:         process.env.INTERFACE || 'eth0',
      heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30'),
      metricsInterval:   parseInt(process.env.METRICS_INTERVAL || '60'),
      logLevel:          process.env.LOG_LEVEL || 'info',
    };
  }
}

const cfg = loadConfig();
const LOG_PREFIX = `[HORNET-AGENT:${hostname()}]`;

function log(level, msg, data = {}) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  if (levels[level] > (levels[cfg.logLevel] || 2)) return;
  const ts = new Date().toISOString();
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `${ts} ${LOG_PREFIX} ${level.toUpperCase()} ${msg}`,
    Object.keys(data).length ? data : '',
  );
}

// ─── XRay Concurrency Lock & Config Paths ────────────────────────────────
const XRAY_CONFIG  = '/usr/local/etc/xray/config.json';
const XRAY_PIDFILE = '/run/xray.pid';

let configLock = Promise.resolve();

function withConfigLock(fn) {
  return async (...args) => {
    let release;
    const prev = configLock;
    configLock = new Promise(resolve => { release = resolve; });
    await prev;
    try { return await fn(...args); }
    finally { release(); }
  };
}

// ─── Atomic XRay Config Read/Write ───────────────────────────────────────
function readXrayConfig() {
  try {
    return JSON.parse(fs.readFileSync(XRAY_CONFIG, 'utf-8'));
  } catch {
    return null;
  }
}

function writeXrayConfigAtomic(config) {
  const tmp = `${XRAY_CONFIG}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmp, XRAY_CONFIG);
}

// ─── XRay Runtime Reload (SIGHUP, no restart) ───────────────────────────
function getXrayPid() {
  try {
    const pid = parseInt(fs.readFileSync(XRAY_PIDFILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function reloadXray() {
  // Strategy: SIGHUP (fast) → systemctl reload → systemctl restart (last resort)
  const pid = getXrayPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGHUP');
      log('info', 'XRay reloaded via SIGHUP (zero-downtime)');
      return;
    } catch (err) {
      log('warn', 'SIGHUP failed, trying systemctl reload', { error: err.message });
    }
  }

  await execPromise('systemctl reload xray')
    .then(() => log('info', 'XRay reloaded via systemctl reload'))
    .catch(async () => {
      log('warn', 'systemctl reload failed, falling back to restart');
      await execPromise('systemctl restart xray');
      log('info', 'XRay restarted');
    });
}

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function getXrayStatus() {
  const pid = getXrayPid();
  if (pid) {
    try {
      process.kill(pid, 0);
      return 'active';
    } catch { /* not running */ }
  }
  try {
    const out = execSync('systemctl is-active xray', { encoding: 'utf-8', timeout: 5000 }).trim();
    return out || 'inactive';
  } catch {
    return 'inactive';
  }
}

// ─── XRay User Management (no restart, uses batch + atomic config) ───────
const createXrayUser = withConfigLock(async (uuid, email, trafficLimitGB = null, expiryDays = null) => {
  const xc = readXrayConfig();
  if (!xc || !xc.inbounds) {
    log('error', 'Cannot read XRay config');
    return null;
  }

  const client = { id: uuid, email };
  if (trafficLimitGB) client.totalGB = trafficLimitGB;
  if (expiryDays) {
    client.expiryTime = new Date(Date.now() + expiryDays * 86400000).toISOString();
  }

  for (const inbound of xc.inbounds) {
    if (!inbound.settings?.clients) continue;
    if (!inbound.settings.clients.find(c => c.email === email)) {
      inbound.settings.clients.push({ ...client });
    }
  }

  writeXrayConfigAtomic(xc);
  await reloadXray();
  log('info', 'XRay user created', { uuid, email });
  return client;
});

const removeXrayUser = withConfigLock(async (email) => {
  const xc = readXrayConfig();
  if (!xc || !xc.inbounds) {
    log('error', 'Cannot read XRay config');
    return null;
  }

  let removed = false;
  for (const inbound of xc.inbounds) {
    if (!inbound.settings?.clients) continue;
    const before = inbound.settings.clients.length;
    inbound.settings.clients = inbound.settings.clients.filter(c => c.email !== email);
    if (inbound.settings.clients.length !== before) removed = true;
  }

  if (removed) {
    writeXrayConfigAtomic(xc);
    await reloadXray();
    log('info', 'XRay user removed', { email });
  }
  return { removed };
});

const disableXrayUser = withConfigLock(async (email) => {
  const xc = readXrayConfig();
  if (!xc || !xc.inbounds) return null;

  for (const inbound of xc.inbounds) {
    if (!inbound.settings?.clients) continue;
    const client = inbound.settings.clients.find(c => c.email === email);
    if (client) client.enable = false;
  }

  writeXrayConfigAtomic(xc);
  await reloadXray();
  log('info', 'XRay user disabled', { email });
  return { disabled: true };
});

const updateXrayConfig = withConfigLock(async (newConfig) => {
  writeXrayConfigAtomic(newConfig);
  await reloadXray();
  log('info', 'XRay config updated');
});

const restartXray = async () => {
  await execPromise('systemctl restart xray');
  log('info', 'XRay fully restarted');
};

function listXrayUsers() {
  const xc = readXrayConfig();
  if (!xc || !xc.inbounds) return [];
  const users = [];
  for (const inbound of xc.inbounds) {
    if (inbound.settings?.clients) {
      users.push(
        ...inbound.settings.clients.map(c => ({
          ...c,
          inboundTag: inbound.tag,
          port: inbound.port,
          protocol: inbound.protocol,
        })),
      );
    }
  }
  return users;
}

// ─── System Metrics (no execSync where possible) ─────────────────────────
function readProc(path) {
  try { return fs.readFileSync(path, 'utf-8').trim(); }
  catch { return ''; }
}

function getSystemMetrics() {
  try {
    const cpu = parseCpu();
    const memInfo = parseMemInfo();
    const disk = parseDisk();
    const uptime = parseUptime();
    const loadAvg = readProc('/proc/loadavg').split(' ').slice(0, 3).map(Number);

    let rxBytes = 0; let txBytes = 0;
    try {
      rxBytes = parseInt(readProc(`/sys/class/net/${cfg.interface}/statistics/rx_bytes`)) || 0;
      txBytes = parseInt(readProc(`/sys/class/net/${cfg.interface}/statistics/tx_bytes`)) || 0;
    } catch { /* interface not found */ }

    return {
      cpuPercent:        Math.round(cpu * 10) / 10,
      memoryBytes:       { total: memInfo.total, available: memInfo.avail, used: memInfo.total - memInfo.avail },
      memoryPercent:     memInfo.total > 0 ? Math.round(((memInfo.total - memInfo.avail) / memInfo.total) * 1000) / 10 : 0,
      diskBytes:         { total: disk.total, used: disk.used, free: disk.total - disk.used },
      diskPercent:       disk.total > 0 ? Math.round((disk.used / disk.total) * 1000) / 10 : 0,
      networkBytes:      { rxBytes, txBytes },
      loadAvg,
      uptimeSeconds:     uptime,
    };
  } catch (err) {
    log('error', 'Failed to collect system metrics', { error: err.message });
    return null;
  }
}

function parseCpu() {
  // Read /proc/stat, compute delta over 100ms to get instant CPU
  const stat1 = readProc('/proc/stat');
  const cpu1 = stat1.match(/^cpu\s+(.*)$/m);
  if (!cpu1) return 0;
  const sum1 = cpu1[1].split(/\s+/).map(Number);
  const idle1 = sum1[3] || 0;
  const total1 = sum1.reduce((a, b) => a + b, 0);

  sleepMs(100);

  const stat2 = readProc('/proc/stat');
  const cpu2 = stat2.match(/^cpu\s+(.*)$/m);
  if (!cpu2) return 0;
  const sum2 = cpu2[1].split(/\s+/).map(Number);
  const idle2 = sum2[3] || 0;
  const total2 = sum2.reduce((a, b) => a + b, 0);

  const dTotal = total2 - total1;
  const dIdle = idle2 - idle1;
  return dTotal > 0 ? ((dTotal - dIdle) / dTotal) * 100 : 0;
}

function sleepMs(ms) {
  const target = Date.now() + ms;
  while (Date.now() < target) { /* spin */ }
}

function parseMemInfo() {
  const info = readProc('/proc/meminfo');
  const get = key => {
    const m = info.match(new RegExp(`^${key}:\\s+(\\d+)`));
    return m ? parseInt(m[1], 10) * 1024 : 0;
  };
  return { total: get('MemTotal'), avail: get('MemAvailable') };
}

function parseDisk() {
  // Use statfs via df -B1 (fast, one exec)
  const out = execSync("df -B1 / | awk 'NR==2{print $2,$3,$4}'", { encoding: 'utf-8', timeout: 3000 }).trim();
  const parts = out.split(/\s+/).map(Number);
  return { total: parts[0] || 0, used: parts[1] || 0, free: parts[2] || 0 };
}

function parseUptime() {
  const up = readProc('/proc/uptime');
  return parseFloat(up.split(/\s+/)[0]) || 0;
}

function getXrayMetrics() {
  try {
    const logFile = '/var/log/xray/access.log';
    if (!fs.existsSync(logFile)) return { activeConnections: 0 };
    const out = execSync(`tail -100 ${logFile} 2>/dev/null | wc -l`, { encoding: 'utf-8', timeout: 3000 }).trim();
    return { activeConnections: parseInt(out) || 0 };
  } catch {
    return { activeConnections: 0 };
  }
}

// ─── Backend Communication ───────────────────────────────────────────────
let registered = false;
let serverId   = null;
let lastMetrics = null;

function signRequest(method, path, body, timestamp, nonce) {
  const payload = `${timestamp}.${nonce}.${method}.${path}.${JSON.stringify(body || {})}`;
  return crypto.createHmac('sha256', cfg.nodeToken).update(payload).digest('hex');
}

async function apiRequest(method, path, body = null) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = signRequest(method, path, body, timestamp, nonce);
  const headers = {
    'Content-Type':      'application/json',
    'X-Node-Token':      cfg.nodeToken,
    'X-Node-Signature':  signature,
    'X-Node-Timestamp':  timestamp,
    'X-Node-Nonce':      nonce,
    'X-Node-Hostname':   hostname(),
  };

  try {
    const res = await Promise.race([
      fetch(`${cfg.backendUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 15000)),
    ]);
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
    nodeToken: cfg.nodeToken,
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
        if (command.config) await updateXrayConfig(command.config);
        break;
      case 'sync_users': {
        const currentUsers = listXrayUsers();
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

// ─── Registration ────────────────────────────────────────────────────────
async function registerSelf() {
  log('info', 'Attempting to register with backend', { url: cfg.backendUrl });

  const ip = execSync("curl -4 -fsSL --max-time 5 ifconfig.me 2>/dev/null || echo '127.0.0.1'", { encoding: 'utf-8' }).trim();
  const xrayStatus = await getXrayStatus();

  const result = await apiRequest('POST', '/api/nodes/register', {
    name: hostname(),
    ipAddress: ip,
    region: cfg.region,
    port: 443,
    xrayApiPort: parseInt(process.env.XRAY_API_PORT || '10085'),
    maxCapacity: 200,
    nodeToken: cfg.nodeToken,
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

// ─── Main Loop ───────────────────────────────────────────────────────────
async function main() {
  log('info', 'Starting HORNET Node Agent', {
    backend: cfg.backendUrl,
    region: cfg.region,
    heartbeatInterval: cfg.heartbeatInterval,
  });

  await registerSelf();
  setInterval(sendHeartbeat, cfg.heartbeatInterval * 1000);
  setInterval(() => {
    const m = getSystemMetrics();
    if (m) log('debug', 'System metrics', {
      cpu: `${m.cpuPercent}%`, mem: `${m.memoryPercent}%`, disk: `${m.diskPercent}%`,
    });
  }, cfg.metricsInterval * 1000);

  const shutdown = async () => {
    log('info', 'Agent shutting down...');
    await apiRequest('POST', '/api/nodes/shutdown', { serverId, nodeToken: cfg.nodeToken });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  log('error', 'Agent fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
