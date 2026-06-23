/**
 * Clash Meta YAML configuration builder.
 *
 * Accepts an array of normalised proxy objects and produces a complete
 * Clash Meta YAML document with proxy-groups, rules, and tunables.
 */

import { serializeYaml } from './yamlSerializer.js';

/**
 * Build a Clash Meta YAML configuration string.
 *
 * @param {object[]} proxies  Array of normalised proxy objects.
 * @param {object}   [opts]
 * @param {string}   [opts.profileName]   Group / profile display name.
 * @param {number}   [opts.mixedPort]     Local mixed-port (default 7890).
 * @returns {string}  Complete YAML string.
 */
export function buildClashConfig(proxies, opts = {}) {
  const profileName = opts.profileName || 'HORNET';
  const mixedPort   = opts.mixedPort || 7890;
  const proxyNames  = proxies.map((p) => p.name || p.remark || 'proxy');

  const doc = {
    'port':               mixedPort,
    'socks-port':         mixedPort + 1,
    'allow-lan':          false,
    'mode':               'rule',
    'log-level':          'info',
    'external-controller': '127.0.0.1:9090',

    'proxies': proxies.map(clashProxyEntry),

    'proxy-groups': [
      {
        name:     profileName,
        type:     'select',
        proxies:  ['DIRECT', 'REJECT', ...proxyNames],
      },
      {
        name:     'Auto',
        type:     'url-test',
        proxies:  proxyNames,
        url:      'http://www.gstatic.com/generate_204',
        interval: 300,
      },
      {
        name:     'Fallback',
        type:     'fallback',
        proxies:  proxyNames,
        url:      'http://www.gstatic.com/generate_204',
        interval: 300,
      },
    ],

    'rules': [
      'DOMAIN-SUFFIX,ir,DIRECT',
      'GEOIP,IR,DIRECT',
      'MATCH,' + profileName,
    ],
  };

  return serializeYaml(doc);
}

/**
 * Convert a normalised proxy object into a Clash-compatible dictionary.
 *
 * Clash uses long-form snake_case property names for each proxy type.
 */
function clashProxyEntry(p) {
  const name = p.name || p.remark || 'HORNET';
  const base = {
    name,
    server: p.address,
    port:   p.port,
  };

  switch (p.type) {
    case 'vless':
      return {
        ...base,
        type:              'vless',
        uuid:              p.uuid,
        tls:               true,
        'servername':      p.sni || p.address,
        'skip-cert-verify': false,
        network:           p.network || 'tcp',
        'client-fingerprint': p.fingerprint || 'chrome',
      };

    case 'trojan':
      return {
        ...base,
        type:              'trojan',
        password:          p.password || p.uuid,
        sni:               p.sni || p.address,
        'skip-cert-verify': false,
      };

    case 'vmess':
      return {
        ...base,
        type:              'vmess',
        uuid:              p.uuid,
        tls:               !!p.tls,
        'servername':      p.sni || (p.tls ? p.address : ''),
        'skip-cert-verify': false,
        network:           p.network || 'tcp',
      };

    case 'shadowsocks':
      return {
        ...base,
        type:     'ss',
        cipher:   p.method || 'chacha20-ietf-poly1305',
        password: p.password,
      };

    default:
      return base;
  }
}
