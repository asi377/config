/**
 * User-Agent parser for VPN client detection.
 *
 * Detects the requesting client application from the User-Agent header
 * and maps it to a subscription format:
 *
 *   clash       → Clash Meta YAML
 *   singbox     → Sing-box JSON
 *   v2rayn      → Base64-encoded URI list (v2rayN / v2rayNG)
 *   shadowrocket → Base64-encoded URI list (Shadowrocket-compatible)
 *   quantumult  → Quantumult X configuration
 *   generic     → Plain Base64-encoded URI list (fallback)
 */

const UA_PATTERNS = [
  { name: 'clash',      regex: /clash-?meta|clashx|clash\b/i                             },
  { name: 'singbox',    regex: /sing-box|singbox|sfi|sfa|sfm/i                            },
  { name: 'v2rayn',     regex: /v2rayng|v2rayn|v2ray\s*ng/i                               },
  { name: 'shadowrocket', regex: /shadowrocket|rocket/i                                   },
  { name: 'quantumult', regex: /quantumult/i                                               },
];

export const FORMATS = {
  CLASH:        'clash',
  SINGBOX:      'singbox',
  V2RAYN:       'v2rayn',
  SHADOWROCKET: 'shadowrocket',
  QUANTUMULT:   'quantumult',
  GENERIC:      'generic',
};

const FORMAT_UA_MAP = {
  [FORMATS.CLASH]:        'clash',
  [FORMATS.SINGBOX]:      'singbox',
  [FORMATS.V2RAYN]:       'v2rayn',
  [FORMATS.SHADOWROCKET]: 'shadowrocket',
  [FORMATS.QUANTUMULT]:   'quantumult',
};

const FORMAT_CONTENT_TYPE = {
  [FORMATS.CLASH]:        'text/yaml; charset=utf-8',
  [FORMATS.SINGBOX]:      'application/json; charset=utf-8',
  [FORMATS.V2RAYN]:       'text/plain; charset=utf-8',
  [FORMATS.SHADOWROCKET]: 'text/plain; charset=utf-8',
  [FORMATS.QUANTUMULT]:   'text/plain; charset=utf-8',
  [FORMATS.GENERIC]:      'text/plain; charset=utf-8',
};

const FORMAT_EXTENSION = {
  [FORMATS.CLASH]:        'yaml',
  [FORMATS.SINGBOX]:      'json',
  [FORMATS.V2RAYN]:       'txt',
  [FORMATS.SHADOWROCKET]: 'txt',
  [FORMATS.QUANTUMULT]:   'txt',
  [FORMATS.GENERIC]:      'txt',
};

/**
 * Detect the subscription format from a User-Agent string.
 *
 * @param {string} userAgent  Raw User-Agent header value (or empty string).
 * @returns {{ format: string, contentType: string, extension: string }}
 */
export function detect(userAgent = '') {
  for (const { name, regex } of UA_PATTERNS) {
    if (regex.test(userAgent)) {
      const format = FORMAT_UA_MAP[name];
      return {
        format,
        contentType: FORMAT_CONTENT_TYPE[format],
        extension: FORMAT_EXTENSION[format],
      };
    }
  }
  return {
    format: FORMATS.GENERIC,
    contentType: FORMAT_CONTENT_TYPE[FORMATS.GENERIC],
    extension: FORMAT_EXTENSION[FORMATS.GENERIC],
  };
}

/**
 * Determine whether a format is a "link-list" type (Base64-encoded URIs).
 * These formats don't need structured config — just share links.
 */
export function isLinkListFormat(format) {
  return format === FORMATS.V2RAYN
      || format === FORMATS.SHADOWROCKET
      || format === FORMATS.QUANTUMULT
      || format === FORMATS.GENERIC;
}
