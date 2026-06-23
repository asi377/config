/**
 * Cloudflare Worker — VPN Subscription Generator
 *
 * ── Flow ──────────────────────────────────────────────────────────────────
 *   User → sub.mydomain.com/:token
 *     1. Cache lookup (raw backend JSON, 60s TTL)
 *     2. Fetch from api.mydomain.com/internal/sub/:token  (if cache miss)
 *     3. Inspect User-Agent → Clash / Sing-box / Base64
 *     4. Render config   → YAML / JSON / Base64-URI-list
 *     5. Apply headers   → Profile-Update-Interval, Subscription-Userinfo, etc.
 *     6. Return response
 *
 * ── Environment Variables ─────────────────────────────────────────────────
 *   BACKEND_URL       — https://api.mydomain.com
 *   INTERNAL_SECRET   — value sent as X-Sub-Secret header
 *   CACHE_TTL         — seconds to cache backend JSON (default 60)
 *
 * ── Deployment ────────────────────────────────────────────────────────────
 *   npx wrangler deploy index.js  --name subscription-worker \
 *     --route 'sub.mydomain.com/*' \
 *     --env BACKEND_URL=https://api.mydomain.com \
 *     --env INTERNAL_SECRET=sub_sec_...
 */

/* ======================================================================== */
/*  Entry point                                                              */
/* ======================================================================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = url.pathname.replace(/^\//, '');

    if (!token || token.length < 8) {
      return new Response('NOT_FOUND', { status: 404 });
    }

    // 1. Fetch raw subscription data (cached for CACHE_TTL seconds)
    const rawData = await getRawSubscription(token, env, ctx);

    if (!rawData) {
      return new Response('NOT_FOUND', { status: 404 });
    }

    const { proxies, profileName, traffic } = rawData;

    if (!proxies || proxies.length === 0) {
      return new Response('NO_SERVERS', { status: 503 });
    }

    // 2. Detect client format from User-Agent
    const userAgent = request.headers.get('User-Agent') || '';
    const format = detectFormat(userAgent);

    // 3. Render
    const [body, contentType, extension] = renderSubscription(
      proxies,
      profileName,
      traffic,
      format,
    );

    // 4. Build response headers
    const headers = buildHeaders(profileName, contentType, extension, traffic);

    return new Response(body, { status: 200, headers });
  },
};

/* ======================================================================== */
/*  Cache layer — backend JSON is cached for CACHE_TTL seconds per token     */
/* ======================================================================== */

const CACHE_KEY_PREFIX = 'https://v0/cache/raw-sub/';

async function getRawSubscription(token, env, ctx) {
  const cache = caches.default;
  const cacheKey = CACHE_KEY_PREFIX + token;

  // Check cache
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached.json();
  }

  // Fetch from backend
  const backendUrl = env.BACKEND_URL || 'http://localhost:3000';
  const secret = env.INTERNAL_SECRET || '';
  const ttl = parseInt(env.CACHE_TTL || '60', 10);

  const response = await fetch(`${backendUrl}/internal/sub/${token}`, {
    headers: {
      'X-Sub-Secret': secret,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  // Cache the raw JSON — clone because we consumed the body above.
  // Caching in the background so the current request isn't blocked on write.
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, s-maxage=${ttl}`,
        },
      }),
    ),
  );

  return data;
}

/* ======================================================================== */
/*  User-Agent detection                                                     */
/* ======================================================================== */

const FORMAT_CLASH = 'clash';
const FORMAT_SINGBOX = 'singbox';
const FORMAT_BASE64 = 'base64';

function detectFormat(ua) {
  if (/clash-?meta|clashx|clash\b/i.test(ua)) return FORMAT_CLASH;
  if (/sing-box|singbox|sfi|sfa|sfm/i.test(ua)) return FORMAT_SINGBOX;
  return FORMAT_BASE64; // v2rayNG, Shadowrocket, Quantumult X, generic
}

/* ======================================================================== */
/*  Router                                                                   */
/* ======================================================================== */

function renderSubscription(proxies, profileName, traffic, format) {
  switch (format) {
    case FORMAT_CLASH:
      return [
        buildClashConfig(proxies, profileName),
        'text/yaml; charset=utf-8',
        'yaml',
      ];
    case FORMAT_SINGBOX:
      return [
        buildSingboxConfig(proxies, profileName),
        'application/json; charset=utf-8',
        'json',
      ];
    default:
      return [
        buildBase64Config(proxies),
        'text/plain; charset=utf-8',
        'txt',
      ];
  }
}

/* ======================================================================== */
/*  Response headers                                                         */
/* ======================================================================== */

function buildHeaders(profileName, contentType, extension, traffic) {
  const { upload = 0, download = 0, total = 0, expire = 0 } = traffic || {};
  const filename = encodeURIComponent(profileName.replace(/\s+/g, '_'));

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}.${extension}"`,
    'Profile-Update-Interval': '24',
    'Profile-Title': profileName,
    'Cache-Control': 'no-store, no-cache',
    'Subscription-Userinfo':
      `upload=${upload}; download=${download}; total=${total}; expire=${expire}`,
  });

  return headers;
}

/* ======================================================================== */
/*  YAML helper — minimal YAML value serializer for Clash config             */
/* ======================================================================== */

const YAML_SPECIAL = /[:{}\[\]&,*?|<>=!%@`\n\r\t]|^\s|\s$|^[0-9]|^(true|false|null)$/;

function yamlString(value) {
  if (value === null || value === undefined) return 'null';
  const str = String(value);
  if (YAML_SPECIAL.test(str) || str === '' || str.includes('#')) {
    return JSON.stringify(str); // double-quote via JSON
  }
  return str;
}

function renderYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      for (const item of value) {
        if (item !== null && typeof item === 'object') {
          lines.push(`${pad}  -`);
          for (const [k, v] of Object.entries(item)) {
            const rendered = renderYamlValue(v, indent + 3);
            lines.push(`${pad}    ${k}: ${rendered}`);
          }
        } else {
          lines.push(`${pad}  - ${yamlString(item)}`);
        }
      }
    } else if (value !== null && typeof value === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(renderYaml(value, indent + 1));
    } else {
      lines.push(`${pad}${key}: ${renderYamlValue(value, indent + 1)}`);
    }
  }

  return lines.join('\n');
}

function renderYamlValue(value, _indent) {
  return yamlString(value);
}

/* ======================================================================== */
/*  Clash Meta YAML builder                                                  */
/* ======================================================================== */

function buildClashConfig(proxies, profileName) {
  const name = profileName || 'VPN';
  const proxyNames = proxies.map((p) => p.remark || p.name || p.address);

  const proxyEntries = proxies.map(clashProxyEntry);

  return renderYaml({
    port: 7890,
    'socks-port': 7891,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    'external-controller': '127.0.0.1:9090',
    proxies: proxyEntries,
    'proxy-groups': [
      {
        name,
        type: 'select',
        proxies: ['DIRECT', 'REJECT', ...proxyNames],
      },
      {
        name: 'Auto',
        type: 'url-test',
        proxies: proxyNames,
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
      },
      {
        name: 'Fallback',
        type: 'fallback',
        proxies: proxyNames,
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
      },
    ],
    rules: [
      'DOMAIN-SUFFIX,ir,DIRECT',
      'GEOIP,IR,DIRECT',
      'MATCH,' + name,
    ],
  });
}

function clashProxyEntry(p) {
  const entry = { name: p.remark || p.name || 'HORNET' };

  switch (p.type) {
    case 'vless':
      return {
        ...entry,
        type: 'vless',
        server: p.address,
        port: p.port,
        uuid: p.uuid,
        tls: !!p.tls,
        servername: p.sni || p.address,
        'skip-cert-verify': false,
        network: p.network || 'tcp',
        'client-fingerprint': p.fingerprint || 'chrome',
        ...(p.publicKey ? { 'reality-opts': { public_key: p.publicKey }, flow: p.flow || '' } : {}),
        ...(p.network === 'ws' || p.network === 'grpc' ? { 'ws-opts': { path: p.path || '/', headers: p.host ? { Host: p.host } : undefined } } : {}),
      };
    case 'trojan':
      return {
        ...entry,
        type: 'trojan',
        server: p.address,
        port: p.port,
        password: p.password,
        sni: p.sni || p.address,
        'skip-cert-verify': false,
        network: p.network || 'tcp',
        ...(p.network === 'ws' ? { 'ws-opts': { path: p.path || '/', headers: p.host ? { Host: p.host } : undefined } } : {}),
      };
    case 'vmess':
      return {
        ...entry,
        type: 'vmess',
        server: p.address,
        port: p.port,
        uuid: p.uuid,
        alterId: 0,
        cipher: p.security || 'auto',
        tls: !!p.tls,
        servername: p.sni || '',
        'skip-cert-verify': false,
        network: p.network || 'tcp',
        ...(p.network === 'ws' ? { 'ws-opts': { path: p.path || '/', headers: p.host ? { Host: p.host } : undefined } } : {}),
      };
    case 'shadowsocks':
      return {
        ...entry,
        type: 'ss',
        server: p.address,
        port: p.port,
        cipher: p.method || 'chacha20-ietf-poly1305',
        password: p.password,
      };
    default:
      return entry;
  }
}

/* ======================================================================== */
/*  Sing-box JSON builder                                                    */
/* ======================================================================== */

function buildSingboxConfig(proxies, profileName) {
  const name = profileName || 'VPN';
  const tags = proxies.map((p) => p.remark || p.name || p.address);

  const outboundProxies = proxies.map(singboxOutbound);

  return JSON.stringify({
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [
        { tag: 'google', address: 'https://dns.google/dns-query' },
        { tag: 'local', address: '223.5.5.5', detour: 'direct' },
      ],
      rules: [{ geoip: ['ir'], server: 'local' }],
    },
    inbounds: [
      { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 },
      { type: 'tun', tag: 'tun-in', inet4_address: '172.19.0.1/30', auto_route: true, strict_route: false },
    ],
    outbounds: [
      {
        type: 'selector',
        tag: name,
        outbounds: ['auto', 'direct', 'block', ...tags],
      },
      {
        type: 'urltest',
        tag: 'auto',
        outbounds: tags,
        url: 'https://www.gstatic.com/generate_204',
        interval: '5m',
        tolerance: 50,
      },
      ...outboundProxies,
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
  }, null, 2);
}

function singboxOutbound(p) {
  const tag = p.remark || p.name || 'HORNET';

  switch (p.type) {
    case 'vless':
      return {
        type: 'vless',
        tag,
        server: p.address,
        server_port: p.port,
        uuid: p.uuid,
        flow: p.flow || '',
        tls: {
          enabled: !!p.tls,
          server_name: p.sni || p.address,
          utls: { enabled: true, fingerprint: p.fingerprint || 'chrome' },
          ...(p.publicKey ? { reality: { enabled: true, public_key: p.publicKey, short_id: p.shortId || '' } } : {}),
        },
        ...(p.network === 'ws' ? {
          transport: { type: 'ws', path: p.path || '/', headers: p.host ? { Host: p.host } : {} },
        } : {}),
        ...(p.network === 'grpc' ? {
          transport: { type: 'grpc', service_name: p.serviceName || '' },
        } : {}),
      };
    case 'trojan':
      return {
        type: 'trojan',
        tag,
        server: p.address,
        server_port: p.port,
        password: p.password,
        tls: {
          enabled: !!p.tls,
          server_name: p.sni || p.address,
        },
        ...(p.network === 'ws' ? {
          transport: { type: 'ws', path: p.path || '/', headers: p.host ? { Host: p.host } : {} },
        } : {}),
      };
    case 'vmess':
      return {
        type: 'vmess',
        tag,
        server: p.address,
        server_port: p.port,
        uuid: p.uuid,
        security: p.security || 'auto',
        tls: {
          enabled: !!p.tls,
          server_name: p.sni || '',
        },
        ...(p.network === 'ws' ? {
          transport: { type: 'ws', path: p.path || '/', headers: p.host ? { Host: p.host } : {} },
        } : {}),
      };
    case 'shadowsocks':
      return {
        type: 'shadowsocks',
        tag,
        server: p.address,
        server_port: p.port,
        method: p.method || 'chacha20-ietf-poly1305',
        password: p.password,
      };
    default:
      return { type: 'direct', tag };
  }
}

/* ======================================================================== */
/*  Link generators — vless:// trojan:// vmess:// ss://                      */
/* ======================================================================== */

function buildShareLink(p) {
  switch (p.type) {
    case 'vless':   return buildVlessLink(p);
    case 'trojan':  return buildTrojanLink(p);
    case 'vmess':   return buildVmessLink(p);
    case 'shadowsocks': return buildSsLink(p);
    default:        return '';
  }
}

function buildVlessLink(p) {
  const params = new URLSearchParams({
    type: p.network || 'tcp',
    security: p.publicKey ? 'reality' : (p.tls ? 'tls' : 'none'),
    fp: p.fingerprint || 'chrome',
    pbk: p.publicKey || '',
    sid: p.shortId || '',
    spx: '/',
    flow: p.flow || '',
    sni: p.sni || p.address,
    path: p.path || '',
    host: p.host || '',
    encryption: p.encryption || 'none',
  });
  const remark = encodeURIComponent(p.remark || p.name || 'HORNET');
  return `vless://${p.uuid}@${p.address}:${p.port}?${params.toString()}#${remark}`;
}

function buildTrojanLink(p) {
  const params = new URLSearchParams({
    security: p.tls ? 'tls' : 'none',
    type: p.network || 'tcp',
    headerType: 'none',
    sni: p.sni || p.address,
    path: p.path || '',
    host: p.host || '',
  });
  const remark = encodeURIComponent(p.remark || p.name || 'HORNET');
  return `trojan://${encodeURIComponent(p.password)}@${p.address}:${p.port}?${params.toString()}#${remark}`;
}

function buildVmessLink(p) {
  const vmessObj = {
    v: '2',
    ps: p.remark || p.name || 'HORNET',
    add: p.address,
    port: p.port,
    id: p.uuid,
    aid: 0,
    scy: p.security || 'auto',
    net: p.network || 'tcp',
    type: 'none',
    host: p.host || '',
    path: p.path || '',
    tls: p.tls ? 'tls' : '',
    sni: p.sni || '',
  };
  const json = JSON.stringify(vmessObj);
  return 'vmess://' + base64Encode(json);
}

function buildSsLink(p) {
  const userInfo = base64Encode(`${p.method || 'chacha20-ietf-poly1305'}:${p.password}`);
  const remark = encodeURIComponent(p.remark || p.name || 'HORNET');
  return `ss://${userInfo}@${p.address}:${p.port}#${remark}`;
}

/* ======================================================================== */
/*  Base64 URI-list builder                                                  */
/* ======================================================================== */

function buildBase64Config(proxies) {
  const links = proxies.map(buildShareLink).filter(Boolean);
  return base64Encode(links.join('\n') + '\n');
}

/* ======================================================================== */
/*  Base64 utility                                                           */
/* ======================================================================== */

function base64Encode(str) {
  // Cloudflare Workers runtime has btoa available.
  // For Unicode safety, encode as UTF-8 first.
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
