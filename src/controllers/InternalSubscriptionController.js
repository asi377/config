import TunnelConfigRepository from '../repositories/TunnelConfigRepository.js';
import SubscriptionRepository from '../repositories/SubscriptionRepository.js';
import ServerRepository from '../repositories/ServerRepository.js';

/**
 * Internal endpoint consumed by the Cloudflare Worker subscription generator.
 *
 * GET /internal/sub/:token
 *
 * Auth:  X-API-Key header (adminApiKey) OR X-Sub-Secret header (internalSubSecret)
 *
 * Returns JSON with the raw proxy array, profile name, and traffic counters.
 * The Worker then renders Clash YAML / Sing-box JSON / Base64 URIs depending
 * on the end-user's User-Agent.
 */
class InternalSubscriptionController {
  async getRawSubscription(req, res, next) {
    try {
      const { token } = req.params;
      const tunnelConfig = await TunnelConfigRepository.findByUuid(token);
      if (!tunnelConfig || !tunnelConfig.isActive) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }
      if (tunnelConfig.isGuestLink && tunnelConfig.isGuestExpired) {
        return res.status(410).json({ error: 'EXPIRED' });
      }

      const sub = await SubscriptionRepository.findById(
        tunnelConfig.subscriptionId.toString(),
        { populate: 'planId' },
      );
      if (!sub || (sub.status !== 'active' && sub.status !== 'on_hold')) {
        return res.status(404).json({ error: 'INACTIVE' });
      }

      const profileName = sub?.planId?.title || 'HORNET';
      const usedBytes   = tunnelConfig.usedQuotaBytes ?? sub?.usedVolumeBytes ?? 0;
      const totalBytes  = tunnelConfig.allocatedQuotaBytes ?? sub?.totalVolumeBytes ?? 0;
      const expireSec   = sub?.expireDate
        ? Math.floor(new Date(sub.expireDate).getTime() / 1000)
        : 0;

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

      const proxies = [];
      for (const server of healthyServers) {
        const host = server.domain || server.ipAddress;
        const port = server.port;
        const tag  = server.name || `${host}-${port}`;

        proxies.push(
          {
            type: 'vless',
            address: host,
            port,
            uuid: token,
            tls: true,
            network: 'tcp',
            fingerprint: 'chrome',
            sni: host,
            publicKey: server.metadata?.realityPublicKey || '',
            flow: '',
            remark: `${tag}-VLESS`,
          },
          {
            type: 'trojan',
            address: host,
            port,
            password: token,
            tls: true,
            sni: host,
            network: 'tcp',
            remark: `${tag}-Trojan`,
          },
          {
            type: 'vmess',
            address: host,
            port,
            uuid: token,
            tls: !!server.tlsCertFingerprint,
            network: 'tcp',
            security: 'auto',
            remark: `${tag}-VMess`,
          },
        );
      }

      return res.json({
        proxies,
        profileName,
        traffic: {
          upload: usedBytes,
          download: 0,
          total: totalBytes,
          expire: expireSec,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

export default new InternalSubscriptionController();
