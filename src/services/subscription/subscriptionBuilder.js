/**
 * SubscriptionBuilder — main orchestrator for subscription config generation.
 *
 * Given a resolved subscription and its proxy configurations, this module
 * detects the client type from the User-Agent and delegates rendering to
 * the appropriate template engine.
 *
 * Usage:
 *   const result = await SubscriptionBuilder.render({ ... inputs ... }, userAgent);
 *   // result → { body, contentType, headers }
 */

import { detect, isLinkListFormat } from './userAgentParser.js';
import { buildShareLinks } from './linkGenerators.js';
import { buildClashConfig } from './templateEngine/clashBuilder.js';
import { buildSingboxConfig } from './templateEngine/singboxBuilder.js';
import { buildBase64Subscription } from './templateEngine/base64Builder.js';

/**
 * Normalise a raw proxy config object to the internal shape.
 *
 * Accepts both the link-generator shape and the legacy
 * ConfigGeneratorService output.
 */
function normaliseProxy(raw, fallbackName) {
  if (raw.type && raw.address) {
    return { ...raw, remark: raw.remark || raw.name || fallbackName };
  }
  return null;
}

class SubscriptionBuilder {
  /**
   * Render a subscription for a given client User-Agent.
   *
   * @param {object}   input
   * @param {string}   input.userId         Subscriber identifier (for logging).
   * @param {string}   input.profileName    Subscription / plan display name.
   * @param {object[]} input.proxies        Array of normalised proxy objects.
   * @param {object}   [input.traffic]
   * @param {number}   [input.traffic.upload]   Bytes used (upload).
   * @param {number}   [input.traffic.download] Bytes used (download).
   * @param {number}   [input.traffic.total]    Total bytes allocated.
   * @param {number}   [input.traffic.expire]   Unix timestamp of expiry.
   * @param {string}   userAgent            Raw User-Agent header.
   * @returns {{ body: string, contentType: string, headers: object }}
   */
  render(input, userAgent = '') {
    const { profileName, proxies, traffic } = input;

    if (!proxies || proxies.length === 0) {
      const err = new Error('No proxies available for subscription');
      err.statusCode = 404;
      throw err;
    }

    // Normalise input proxies
    const normalised = proxies
      .map((p) => normaliseProxy(p, profileName))
      .filter(Boolean);

    // Detect client type
    const { format, contentType, extension } = detect(userAgent);
    const filename = `${profileName || 'subscription'}.${extension}`;

    // Build headers
    const headers = {
      'Content-Type':              contentType,
      'Content-Disposition':       `attachment; filename="${filename}"`,
      'Profile-Update-Interval':   '24',
      'Profile-Title':             profileName || 'HORNET',
      'Cache-Control':             'no-store, no-cache',
      'Subscription-Userinfo':     this._buildUserInfo(traffic),
    };

    // Render
    if (isLinkListFormat(format)) {
      return this._renderLinkList(normalised, headers, profileName);
    }

    switch (format) {
      case 'clash':
        return this._renderClash(normalised, headers, profileName);
      case 'singbox':
        return this._renderSingbox(normalised, headers, profileName);
      default:
        return this._renderLinkList(normalised, headers, profileName);
    }
  }

  /* ── Private renderers ──────────────────────────────────────────────────── */

  _renderClash(proxies, headers, profileName) {
    const body = buildClashConfig(proxies, { profileName });
    return { body, contentType: headers['Content-Type'], headers };
  }

  _renderSingbox(proxies, headers, profileName) {
    const config = buildSingboxConfig(proxies, { profileName });
    const body = JSON.stringify(config, null, 2);
    return { body, contentType: headers['Content-Type'], headers };
  }

  _renderLinkList(proxies, headers, _profileName) {
    const links = buildShareLinks(proxies);
    const body = buildBase64Subscription(links);
    return { body, contentType: headers['Content-Type'], headers };
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  _buildUserInfo(traffic) {
    if (!traffic) return '';
    const parts = [];
    if (traffic.upload   != null) parts.push(`upload=${traffic.upload}`);
    if (traffic.download != null) parts.push(`download=${traffic.download}`);
    if (traffic.total    != null) parts.push(`total=${traffic.total}`);
    if (traffic.expire   != null) parts.push(`expire=${traffic.expire}`);
    return parts.join('; ');
  }
}

export default new SubscriptionBuilder();
