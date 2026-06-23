/**
 * Sing-box JSON configuration builder.
 *
 * Accepts an array of normalised proxy objects and produces a complete
 * Sing-box JSON document with outbound selectors, urltest groups, and
 * routing rules.
 */

/**
 * Build a Sing-box JSON configuration object (not yet serialised).
 *
 * @param {object[]} proxies  Array of normalised proxy objects.
 * @param {object}   [opts]
 * @param {string}   [opts.profileName]   Selector / profile name.
 * @returns {object}  Sing-box configuration graph.
 */
export function buildSingboxConfig(proxies, opts = {}) {
  const profileName = opts.profileName || 'HORNET';

  // Build individual outbound entries for each proxy
  const outboundEntries = proxies.map(singboxOutbound);

  const tags = outboundEntries.map((o) => o.tag);

  return {
    log: {
      level:     'info',
      timestamp: true,
    },

    dns: {
      servers: [
        { tag: 'google', address: 'https://dns.google/dns-query' },
        { tag: 'local',  address: '223.5.5.5', detour: 'direct' },
      ],
      rules: [
        { geoip: ['ir'], server: 'local' },
      ],
    },

    inbounds: [
      {
        type:       'mixed',
        tag:        'mixed-in',
        listen:     '127.0.0.1',
        listen_port: 2080,
      },
      {
        type:          'tun',
        tag:           'tun-in',
        inet4_address: '172.19.0.1/30',
        auto_route:    true,
        strict_route:  false,
      },
    ],

    outbounds: [
      {
        type:     'selector',
        tag:      profileName,
        outbounds: ['auto', 'direct', 'block', ...tags],
      },
      {
        type:      'urltest',
        tag:       'auto',
        outbounds: tags,
        url:       'https://www.gstatic.com/generate_204',
        interval:  '5m',
        tolerance: 50,
      },
      ...outboundEntries,
      { type: 'direct', tag: 'direct' },
      { type: 'block',  tag: 'block'  },
      { type: 'dns',    tag: 'dns-out' },
    ],

    route: {
      rules: [
        { protocol: 'dns',                     outbound: 'dns-out' },
        { geoip:    ['ir'],                    outbound: 'direct'  },
        { geosite:  ['ir'],                    outbound: 'direct'  },
      ],
      auto_detect_interface: true,
    },
  };
}

/**
 * Convert a normalised proxy object into a Sing-box outbound entry.
 */
function singboxOutbound(p) {
  const tag = p.name || p.remark || 'HORNET';

  switch (p.type) {
    case 'vless':
      return {
        type:        'vless',
        tag,
        server:      p.address,
        server_port: p.port,
        uuid:        p.uuid,
        flow:        p.flow || '',
        tls: {
          enabled:     true,
          server_name: p.sni || p.address,
          utls: {
            enabled:     true,
            fingerprint: p.fingerprint || 'chrome',
          },
        },
      };

    case 'trojan':
      return {
        type:        'trojan',
        tag,
        server:      p.address,
        server_port: p.port,
        password:    p.password || p.uuid,
        tls: {
          enabled:     true,
          server_name: p.sni || p.address,
        },
      };

    case 'vmess':
      return {
        type:        'vmess',
        tag,
        server:      p.address,
        server_port: p.port,
        uuid:        p.uuid,
        security:    p.encryption || 'auto',
        tls: {
          enabled:     !!p.tls,
          server_name: p.sni || (p.tls ? p.address : ''),
        },
      };

    case 'shadowsocks':
      return {
        type:        'shadowsocks',
        tag,
        server:      p.address,
        server_port: p.port,
        method:      p.method || 'chacha20-ietf-poly1305',
        password:    p.password,
      };

    default:
      return { type: 'direct', tag };
  }
}
