/**
 * SmartSubscriptionService
 *
 * Marzban-style subscription delivery:
 *  - Clash      → text/yaml
 *  - Sing-box   → application/json
 *  - Unknown    → text/plain  (Base64-encoded share-link list)
 *
 * Zero external dependencies: YAML is serialised by a minimal hand-written
 * serialiser that covers everything Clash Meta needs.
 */

import ServerRepository from '../repositories/ServerRepository.js';
import TunnelConfigRepository from '../repositories/TunnelConfigRepository.js';
import SubscriptionRepository from '../repositories/SubscriptionRepository.js';
import ConfigGeneratorService from './infra/ConfigGeneratorService.js';
import logger from '../config/logger.js';

// ─── Tiny YAML serialiser (Clash-compatible subset) ───────────────────────────
// Supports: string, number, boolean, null, plain array, plain object.
// Strings that need quoting are double-quoted; everything else is unquoted.

const NEEDS_QUOTE = /[:#\[\]{},&*?|<>=!%@`\n\r\t]|^[\s-]|[\s]$/; // eslint-disable-line no-useless-escape

function yamlStr(v) {
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  if (s === '') return "''";
  if (NEEDS_QUOTE.test(s) || s === 'true' || s === 'false' || s === 'null' || /^\d/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

function serializeYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]\n';
    return obj
      .map((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const entries = Object.entries(item);
          const first = entries[0];
          const rest = entries.slice(1);
          let out = `${pad}- ${first[0]}: ${serializeYamlValue(first[1], indent + 1).trimEnd()}\n`;
          for (const [k, v] of rest) {
            out += `${pad}  ${k}: ${serializeYamlValue(v, indent + 1).trimEnd()}\n`;
          }
          return out;
        }
        return `${pad}- ${serializeYamlValue(item, indent + 1).trimEnd()}\n`;
      })
      .join('');
  }

  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj)
      .map(([k, v]) => `${pad}${k}: ${serializeYamlValue(v, indent + 1).trimEnd()}\n`)
      .join('');
  }

  return serializeYamlValue(obj, indent);
}

function serializeYamlValue(v, indent) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return yamlStr(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    // Inline array for simple scalar lists (e.g. cipher lists, group names)
    if (v.every((i) => typeof i !== 'object' || i === null)) {
      return '[' + v.map((i) => yamlStr(String(i))).join(', ') + ']';
    }
    return '\n' + serializeYaml(v, indent);
  }
  if (typeof v === 'object') {
    return '\n' + serializeYaml(v, indent);
  }
  return String(v);
}

function toYaml(doc) {
  return serializeYaml(doc, 0);
}

// ─── User-Agent detection ─────────────────────────────────────────────────────

const UA_FORMATS = {
  CLASH: /clash/i,
  SINGBOX: /sing-box|singbox/i,
};

function detectFormat(userAgent = '') {
  if (UA_FORMATS.CLASH.test(userAgent)) return 'clash';
  if (UA_FORMATS.SINGBOX.test(userAgent)) return 'singbox';
  return 'base64';
}

// ─── Format builders ──────────────────────────────────────────────────────────

/**
 * Build an array of server proxy objects for a given UUID.
 * Each active server produces one proxy entry per allowed protocol.
 *
 * Returns { vmessLinks[], vlessLinks[], trojanLinks[], clashProxies[], singboxOutbounds[] }
 */
function buildServerConfigs(uuid, servers) {
  const vmessLinks = [];
  const vlessLinks = [];
  const trojanLinks = [];
  const clashProxies = [];
  const singboxOutbounds = [];

  for (const server of servers) {
    const host = server.domain || server.ipAddress;
    const port = server.port;
    const tag = server.name ? `${server.name}-${port}` : `HORNET-${host}-${port}`;

    // ── VLESS share link ──────────────────────────────────────────────────
    const vlessCfg = ConfigGeneratorService.generateVLESSConfig({ uuid, server, port });
    vlessLinks.push(vlessCfg.shareLink);

    // ── Trojan share link ─────────────────────────────────────────────────
    const trojanCfg = ConfigGeneratorService.generateTrojanConfig({ uuid, server, port });
    trojanLinks.push(trojanCfg.shareLink);

    // ── VMess share link ──────────────────────────────────────────────────
    const vmessCfg = ConfigGeneratorService.generateVMessConfig({ uuid, server, port });
    vmessLinks.push(vmessCfg.shareLink);

    // ── Clash proxy entries ───────────────────────────────────────────────
    // VLESS (Reality)
    clashProxies.push({
      name: `${tag}-vless`,
      type: 'vless',
      server: host,
      port,
      uuid,
      tls: true,
      network: 'tcp',
      'client-fingerprint': 'chrome',
    });

    // Trojan
    clashProxies.push({
      name: `${tag}-trojan`,
      type: 'trojan',
      server: host,
      port,
      password: uuid,
      sni: host,
    });

    // ── Sing-box outbounds ────────────────────────────────────────────────
    singboxOutbounds.push({
      type: 'vless',
      tag: `${tag}-vless`,
      server: host,
      server_port: port,
      uuid,
      tls: {
        enabled: true,
        server_name: host,
        utls: { enabled: true, fingerprint: 'chrome' },
      },
    });

    singboxOutbounds.push({
      type: 'trojan',
      tag: `${tag}-trojan`,
      server: host,
      server_port: port,
      password: uuid,
      tls: {
        enabled: true,
        server_name: host,
      },
    });
  }

  return { vmessLinks, vlessLinks, trojanLinks, clashProxies, singboxOutbounds };
}

// ── Clash YAML ────────────────────────────────────────────────────────────────

function buildClashYaml(proxies, subscriptionName) {
  const proxyNames = proxies.map((p) => p.name);

  const doc = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    'external-controller': '127.0.0.1:9090',

    proxies,

    'proxy-groups': [
      {
        name: subscriptionName || 'HORNET',
        type: 'select',
        proxies: ['DIRECT', ...proxyNames],
      },
      {
        name: 'Auto',
        type: 'url-test',
        proxies: proxyNames,
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
      },
    ],

    rules: ['GEOIP,IR,DIRECT', 'MATCH,' + (subscriptionName || 'HORNET')],
  };

  return toYaml(doc);
}

// ── Sing-box JSON ─────────────────────────────────────────────────────────────

function buildSingBoxJson(outbounds, subscriptionName) {
  const tags = outbounds.map((o) => o.tag);

  return {
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [
        { tag: 'google', address: 'https://dns.google/dns-query' },
        { tag: 'local', address: '223.5.5.5', detour: 'direct' },
      ],
      rules: [{ geoip: ['ir'], server: 'local' }],
    },
    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: 2080,
      },
      {
        type: 'tun',
        tag: 'tun-in',
        inet4_address: '172.19.0.1/30',
        auto_route: true,
        strict_route: false,
      },
    ],
    outbounds: [
      {
        type: 'selector',
        tag: subscriptionName || 'HORNET',
        outbounds: ['auto', 'direct', ...tags],
      },
      {
        type: 'urltest',
        tag: 'auto',
        outbounds: tags,
        url: 'https://www.gstatic.com/generate_204',
        interval: '5m',
        tolerance: 50,
      },
      ...outbounds,
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
      { type: 'dns', tag: 'dns-out' },
    ],
    route: {
      rules: [
        { protocol: 'dns', outbound: 'dns-out' },
        { geoip: ['ir'], outbound: 'direct' },
        { geosite: ['ir'], outbound: 'direct' },
      ],
      auto_detect_interface: true,
    },
  };
}

// ── Base64 fallback ───────────────────────────────────────────────────────────

function buildBase64Links(vmessLinks, vlessLinks, trojanLinks) {
  const allLinks = [...vlessLinks, ...trojanLinks, ...vmessLinks];
  return Buffer.from(allLinks.join('\n')).toString('base64');
}

// ─── Main service ─────────────────────────────────────────────────────────────

class SmartSubscriptionService {
  /**
   * Resolve the TunnelConfig (sub-link) for the given UUID,
   * verify it's active + not expired/exhausted,
   * then render the appropriate format based on User-Agent.
   *
   * Returns { contentType, body } ready to send.
   */
  async render(uuid, userAgent = '') {
    // 1. Load tunnel config
    const tunnelConfig = await TunnelConfigRepository.findByUuid(uuid);
    if (!tunnelConfig || !tunnelConfig.isActive) {
      return null; // caller sends 404
    }
    if (tunnelConfig.isGuestLink && tunnelConfig.isGuestExpired) {
      return null;
    }

    // 2. Load parent subscription to get a friendly name
    const sub = await SubscriptionRepository.findById(tunnelConfig.subscriptionId.toString(), { populate: 'planId' });
    const subscriptionName = sub?.planId?.title || 'HORNET';

    // 3. Load all healthy active servers
    const servers = await ServerRepository.findActive();
    const healthyServers = servers.filter((s) => s.healthStatus !== 'unhealthy' && s.status === 'active');

    if (healthyServers.length === 0) {
      logger.warn({ uuid }, '[smart-sub] No healthy servers available');
      return null;
    }

    // 4. Build per-server configs
    const { vmessLinks, vlessLinks, trojanLinks, clashProxies, singboxOutbounds } = buildServerConfigs(
      uuid,
      healthyServers,
    );

    // 5. Build subscription user-info for header
    const upload   = tunnelConfig.usedQuotaBytes ?? sub?.usedVolumeBytes ?? 0;
    const download = 0;
    const total    = tunnelConfig.allocatedQuotaBytes ?? sub?.totalVolumeBytes ?? 0;
    const expire   = sub?.expireDate ? Math.floor(new Date(sub.expireDate).getTime() / 1000) : 0;
    const subInfo  = { upload, download, total, expire };

    // 6. Detect format from User-Agent
    const format = detectFormat(userAgent);
    logger.debug({ uuid, userAgent, format }, '[smart-sub] Rendering subscription');

    switch (format) {
      case 'clash': {
        const yaml = buildClashYaml(clashProxies, subscriptionName);
        return {
          contentType: 'text/yaml; charset=utf-8',
          body: yaml,
          format: 'clash',
          subInfo,
        };
      }

      case 'singbox': {
        const json = buildSingBoxJson(singboxOutbounds, subscriptionName);
        return {
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(json, null, 2),
          format: 'singbox',
          subInfo,
        };
      }

      default: {
        const base64 = buildBase64Links(vmessLinks, vlessLinks, trojanLinks);
        return {
          contentType: 'text/plain; charset=utf-8',
          body: base64,
          format: 'base64',
          subInfo,
        };
      }
    }
  }
}

export default new SmartSubscriptionService();
