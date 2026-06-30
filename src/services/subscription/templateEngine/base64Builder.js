/**
 * Base64 link-list builder.
 *
 * Renders an array of proxy objects into a newline-separated list of
 * share-link URIs, then Base64-encodes the result.
 *
 * This format is consumed by:
 *   - v2rayNG / v2rayN
 *   - Shadowrocket
 *   - Generic / fallback clients
 */

/**
 * Build a Base64-encoded subscription payload from share-link URIs.
 *
 * @param {string[]} shareLinks  Array of pre-built URI strings.
 * @returns {string}  Base64-encoded, newline-separated link list.
 */
export function buildBase64Subscription(shareLinks) {
  if (!shareLinks || shareLinks.length === 0) return '';
  const plain = shareLinks.join('\n') + '\n';
  return Buffer.from(plain).toString('base64');
}

/**
 * Decode a Base64 subscription payload back to a list of links.
 * Useful for clients that send their config as Base64.
 */
export function decodeBase64Subscription(encoded) {
  try {
    const plain = Buffer.from(encoded, 'base64').toString('utf-8');
    return plain.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
