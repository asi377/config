/**
 * Shared proxy-object builder.
 *
 * Produces the normalised proxy objects for a set of healthy servers + a user
 * UUID, honoring each node's advertised transport (metadata.security / network /
 * protocols). Used by BOTH the public /sub/:uuid endpoint and the bot's
 * direct-config delivery, so the two never diverge.
 */

/**
 * @param {Array<object>} healthyServers  active + non-unhealthy Server docs
 * @param {string} uuid                    the tunnel UUID (vless id / trojan pw)
 * @returns {Array<object>} proxy objects consumable by linkGenerators.buildShareLinks
 */
export function buildProxies(healthyServers, uuid) {
  const proxies = [];
  for (const server of healthyServers) {
    const host = server.domain || server.ipAddress;
    const port = server.port;
    const tag = server.name || `${host}-${port}`;
    const meta = server.metadata || {};
    const security = meta.security || (meta.realityPublicKey ? 'reality' : 'tls');
    const network = meta.network || 'tcp';

    const vless = {
      type: 'vless',
      address: host,
      port,
      uuid,
      network,
      encryption: 'none',
      remark: `${tag}-VLESS`,
    };
    if (security === 'reality') {
      vless.tls = true;
      vless.fingerprint = meta.fingerprint || 'chrome';
      vless.sni = meta.sni || host;
      vless.publicKey = meta.realityPublicKey || '';
      vless.shortId = meta.realityShortId || '';
      if (meta.flow) vless.flow = meta.flow;
    } else if (security === 'tls') {
      vless.tls = true;
      vless.fingerprint = meta.fingerprint || 'chrome';
      vless.sni = meta.sni || host;
    } else {
      vless.tls = false; // plain transport (local/dev node)
    }
    proxies.push(vless);

    const protocols = Array.isArray(meta.protocols) ? meta.protocols : [];
    if (protocols.includes('trojan')) {
      proxies.push({
        type: 'trojan', address: host, port, password: uuid,
        tls: security !== 'none', sni: meta.sni || host, remark: `${tag}-Trojan`,
      });
    }
    if (protocols.includes('vmess')) {
      proxies.push({
        type: 'vmess', address: host, port, uuid,
        tls: security === 'tls', network, remark: `${tag}-VMess`,
      });
    }
  }
  return proxies;
}
