/**
 * VPN proxy URI generators.
 *
 * Converts raw proxy configuration objects into standard share-link URIs:
 *   vless://  trojan://  vmess://  ss://
 *
 * Proxy object shape:
 * {
 *   type: 'vless' | 'trojan' | 'vmess' | 'shadowsocks',
 *   address: string,
 *   port: number,
 *   uuid?: string,
 *   password?: string,
 *   method?: string,              // shadowsocks cipher
 *   tls?: boolean,
 *   sni?: string,
 *   network?: 'tcp' | 'ws' | 'grpc',
 *   flow?: string,                // vless reality
 *   fingerprint?: string,          // client fingerprint
 *   publicKey?: string,            // reality public key
 *   shortId?: string,              // reality short id
 *   encryption?: string,           // vmess security
 *   path?: string,                 // websocket path
 *   host?: string,                 // websocket host
 *   remark?: string,               // display name
 * }
 */

import { URLSearchParams } from 'url';

/**
 * Build a share-link URI for a single proxy object.
 *
 * @param {object} proxy  Normalised proxy configuration (see shape above).
 * @returns {string}       Standard URI (vless:// trojan:// vmess:// ss://).
 */
export function buildShareLink(proxy) {
  switch (proxy.type) {
    case 'vless':         return buildVLESS(proxy);
    case 'trojan':        return buildTrojan(proxy);
    case 'vmess':         return buildVMess(proxy);
    case 'shadowsocks':   return buildShadowsocks(proxy);
    default:              throw new Error(`Unsupported proxy type: ${proxy.type}`);
  }
}

/**
 * Build a list of share-link URIs from an array of proxy objects.
 */
export function buildShareLinks(proxies) {
  return proxies.map(buildShareLink);
}

/* ── VLESS ─────────────────────────────────────────────────────────────────── */

function buildVLESS(p) {
  const params = new URLSearchParams({
    type:     p.network || 'tcp',
    security: p.tls ? (p.publicKey ? 'reality' : 'tls') : 'none',
    fp:       p.fingerprint || 'chrome',
    pbk:      p.publicKey || '',
    sid:      p.shortId || '',
    spx:      '/',
  });
  if (p.flow)     params.set('flow', p.flow);
  if (p.sni)      params.set('sni', p.sni);
  if (p.path)     params.set('path', p.path);
  if (p.host)     params.set('host', p.host);
  if (p.encryption !== undefined) params.set('encryption', p.encryption);

  const remark = encodeURIComponent(p.remark || 'HORNET');
  return `vless://${p.uuid}@${p.address}:${p.port}?${params.toString()}#${remark}`;
}

/* ── Trojan ────────────────────────────────────────────────────────────────── */

function buildTrojan(p) {
  const params = new URLSearchParams({
    security:   p.tls ? 'tls' : 'none',
    type:       p.network || 'tcp',
    headerType: 'none',
  });
  if (p.sni)      params.set('sni', p.sni);
  if (p.path)     params.set('path', p.path);
  if (p.host)     params.set('host', p.host);

  const remark = encodeURIComponent(p.remark || 'HORNET');
  const password = p.password || p.uuid || '';
  return `trojan://${encodeURIComponent(password)}@${p.address}:${p.port}?${params.toString()}#${remark}`;
}

/* ── VMess ──────────────────────────────────────────────────────────────────── */

function buildVMess(p) {
  const config = {
    v:    '2',
    ps:   p.remark || 'HORNET',
    add:  p.address,
    port: p.port,
    id:   p.uuid,
    aid:  0,
    scy:  p.encryption || 'auto',
    net:  p.network || 'tcp',
    type: 'none',
    host: p.host || '',
    path: p.path || '',
    tls:  p.tls ? 'tls' : '',
    sni:  p.sni || '',
  };
  const base64 = Buffer.from(JSON.stringify(config)).toString('base64url');
  return `vmess://${base64}`;
}

/* ── Shadowsocks ────────────────────────────────────────────────────────────── */

function buildShadowsocks(p) {
  const method = p.method || 'chacha20-ietf-poly1305';
  const password = p.password || '';
  const userInfo = Buffer.from(`${method}:${password}`).toString('base64url');
  const remark = encodeURIComponent(p.remark || 'HORNET');
  return `ss://${userInfo}@${p.address}:${p.port}#${remark}`;
}
