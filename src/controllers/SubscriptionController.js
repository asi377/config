/**
 * SubscriptionController
 *
 * Handles the public subscription endpoint:
 *   GET /sub/:uuid
 *
 * The UUID acts as an opaque access token (no additional auth).
 * Client format is determined from the User-Agent header.
 *
 * Delegates rendering to the modular SubscriptionBuilder pipeline.
 */

import TunnelConfigRepository from '../repositories/TunnelConfigRepository.js';
import SubscriptionRepository from '../repositories/SubscriptionRepository.js';
import ServerRepository from '../repositories/ServerRepository.js';
import SubscriptionBuilder from '../services/subscription/subscriptionBuilder.js';
import logger from '../config/logger.js';

class SubscriptionController {
  /**
   * GET /sub/:uuid
   */
  async getSubscription(req, res, next) {
    try {
      const { uuid } = req.params;
      const userAgent = req.headers['user-agent'] || '';

      logger.info({ uuid, userAgent, ip: req.ip }, '[sub] Fetching subscription');

      // 1. Resolve the tunnel / sub-link by UUID
      const tunnelConfig = await TunnelConfigRepository.findByUuid(uuid);
      if (!tunnelConfig || !tunnelConfig.isActive) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found or inactive',
        });
      }
      if (tunnelConfig.isGuestLink && tunnelConfig.isGuestExpired) {
        return res.status(410).json({
          success: false,
          error: 'Guest link has expired',
        });
      }

      // 2. Load parent subscription for plan name and user info
      const sub = await SubscriptionRepository.findById(
        tunnelConfig.subscriptionId.toString(),
        { populate: 'planId' },
      );
      if (!sub || (sub.status !== 'active' && sub.status !== 'on_hold')) {
        return res.status(404).json({
          success: false,
          error: 'Subscription is not active',
        });
      }

      const profileName = sub?.planId?.title || 'HORNET';
      const usedBytes   = tunnelConfig.usedQuotaBytes ?? sub?.usedVolumeBytes ?? 0;
      const totalBytes  = tunnelConfig.allocatedQuotaBytes ?? sub?.totalVolumeBytes ?? 0;
      const expireSec   = sub?.expireDate
        ? Math.floor(new Date(sub.expireDate).getTime() / 1000)
        : 0;

      // 3. Load servers and filter by health / plan-type
      const servers = await ServerRepository.findActive();
      let healthyServers = servers.filter(
        (s) => s.healthStatus !== 'unhealthy' && s.status === 'active',
      );

      const planTitle = (sub?.planId?.title || '').toLowerCase();
      if (planTitle === 'gaming') {
        healthyServers = healthyServers.filter(
          (s) => s.tags?.some((t) => t.toLowerCase() === 'gaming'),
        );
      } else if (planTitle === 'dedicated') {
        healthyServers = healthyServers.filter(
          (s) => s.isDedicated === true
            && s.dedicatedTo?.toString() === sub.ownerId.toString(),
        );
      }

      if (healthyServers.length === 0) {
        logger.warn({ uuid, planTitle }, '[sub] No healthy servers available');
        return res.status(503).json({
          success: false,
          error: 'No servers available',
        });
      }

      // 4. Build proxy objects from each server, honoring the transport each
      //    node actually serves (metadata.security / network / protocols) so the
      //    emitted share-link matches the running Xray inbound and connects.
      //    - security: 'reality' | 'tls' | 'none'  (default inferred)
      //    - protocols: extra inbounds the node also serves (trojan/vmess)
      const proxies = [];
      for (const server of healthyServers) {
        const host = server.domain || server.ipAddress;
        const port = server.port;
        const tag  = server.name || `${host}-${port}`;
        const meta = server.metadata || {};
        const security = meta.security || (meta.realityPublicKey ? 'reality' : 'tls');
        const network  = meta.network || 'tcp';

        const vless = {
          type:       'vless',
          address:    host,
          port,
          uuid,
          network,
          encryption: 'none',
          remark:     `${tag}-VLESS`,
        };
        if (security === 'reality') {
          vless.tls         = true;
          vless.fingerprint = meta.fingerprint || 'chrome';
          vless.sni         = meta.sni || host;
          vless.publicKey   = meta.realityPublicKey || '';
          vless.shortId     = meta.realityShortId || '';
          if (meta.flow) vless.flow = meta.flow;
        } else if (security === 'tls') {
          vless.tls         = true;
          vless.fingerprint = meta.fingerprint || 'chrome';
          vless.sni         = meta.sni || host;
        } else {
          vless.tls = false; // plain transport (local/dev node)
        }
        proxies.push(vless);

        // Only advertise additional protocols the node actually serves.
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

      // 5. Render via the modular builder
      const result = SubscriptionBuilder.render(
        {
          userId:      sub.ownerId,
          profileName,
          proxies,
          traffic: {
            upload:   usedBytes,
            download: 0,
            total:    totalBytes,
            expire:   expireSec,
          },
        },
        userAgent,
      );

      // 6. Apply response headers
      for (const [key, value] of Object.entries(result.headers)) {
        if (value) res.setHeader(key, value);
      }

      return res.send(result.body);
    } catch (err) {
      next(err);
    }
  }
}

export default new SubscriptionController();
