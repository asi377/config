/**
 * SubscriptionController
 *
 * Handles the public subscription endpoint:
 *   GET /sub/:uuid
 *
 * Detects client User-Agent and delegates rendering to SmartSubscriptionService.
 */

import SmartSubscriptionService from '../services/SmartSubscriptionService.js';
import logger from '../config/logger.js';

class SubscriptionController {
  /**
   * GET /sub/:uuid
   *
   * No authentication required — the UUID itself is the opaque token.
   * The response format is negotiated from the User-Agent header:
   *   - Clash      → text/yaml
   *   - Sing-box   → application/json
   *   - Other      → text/plain (Base64)
   */
  async getSubscription(req, res, next) {
    try {
      const { uuid } = req.params;
      const userAgent = req.headers['user-agent'] || '';

      logger.info(
        { uuid, userAgent, ip: req.ip },
        '[sub] Subscription fetch',
      );

      const result = await SmartSubscriptionService.render(uuid, userAgent);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found or inactive',
        });
      }

      // Subscription-info header (compatible with Clash / Sing-box clients)
      if (result.format !== 'base64') {
        res.setHeader('Subscription-Userinfo', _buildUserInfoHeader(req._subInfo));
        res.setHeader('Profile-Title', 'HORNET');
        res.setHeader('Support-Url', 'https://t.me/support');
        res.setHeader('Profile-Update-Interval', '6'); // hours
      }

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache');
      return res.send(result.body);
    } catch (err) {
      next(err);
    }
  }
}

/** Build the Subscription-Userinfo header (optional, best-effort). */
function _buildUserInfoHeader(info) {
  if (!info) return '';
  const parts = [];
  if (info.upload    != null) parts.push(`upload=${info.upload}`);
  if (info.download  != null) parts.push(`download=${info.download}`);
  if (info.total     != null) parts.push(`total=${info.total}`);
  if (info.expire    != null) parts.push(`expire=${info.expire}`);
  return parts.join('; ');
}

export default new SubscriptionController();
