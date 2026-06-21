import crypto from 'crypto';
import BaseService from '../../shared/BaseService.js';

class ConfigGeneratorService extends BaseService {
  generateVMessConfig({ uuid, server, port, _encryption = 'auto', security = 'auto' }) {
    const host = server.domain || server.ipAddress;
    const config = {
      v: '2',
      ps: server.name || 'HORNET',
      add: host,
      port: port || server.port,
      id: uuid,
      aid: 0,
      scy: security,
      net: 'tcp',
      type: 'none',
      host: '',
      path: '',
      tls: '',
    };

    const base64 = Buffer.from(JSON.stringify(config)).toString('base64url');
    const shareLink = `vmess://${base64}`;
    const subscriptionLink = this._generateSubscriptionLink(config, 'vmess');

    return { config, shareLink, subscriptionLink, uuid, host, port: port || server.port };
  }

  generateVLESSConfig({ uuid, server, port, flow = '', encryption = 'none', security = 'reality', _serverName = '', shortIds = [''] }) {
    const host = server.domain || server.ipAddress;
    const params = new URLSearchParams({
      type: 'tcp',
      flow,
      encryption,
      security,
      fp: 'chrome',
      pbk: server.metadata?.realityPublicKey || '',
      sid: shortIds[0] || '',
      spx: '/',
    });

    const shareLink = `vless://${uuid}@${host}:${port || server.port}?${params.toString()}#${encodeURIComponent(server.name || 'HORNET')}`;

    return {
      shareLink,
      subscriptionLink: shareLink,
      uuid,
      host,
      port: port || server.port,
      protocol: 'vless',
    };
  }

  generateTrojanConfig({ uuid, server, port, password }) {
    const host = server.domain || server.ipAddress;
    const pass = password || uuid;
    const params = new URLSearchParams({
      security: 'tls',
      type: 'tcp',
      headerType: 'none',
    });

    const shareLink = `trojan://${pass}@${host}:${port || server.port}?${params.toString()}#${encodeURIComponent(server.name || 'HORNET')}`;
    return { shareLink, subscriptionLink: shareLink, password: pass, host, port: port || server.port };
  }

  generateSubscriptionPage(configs, _serverName = 'HORNET') {
    const lines = configs.map(c => c.shareLink || c.subscriptionLink).filter(Boolean);
    return Buffer.from(lines.join('\n')).toString('base64');
  }

  generateQRCode(shareLink) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(shareLink)}`;
  }

  generateV2RayJSON({ uuid, server, port, _protocol = 'vmess' }) {
    const host = server.domain || server.ipAddress;
    const outbound = {
      protocol: 'vmess',
      settings: {
        vnext: [{
          address: host,
          port: port || server.port,
          users: [{ id: uuid, alterId: 0, security: 'auto' }],
        }],
      },
      streamSettings: {
        network: 'tcp',
        security: 'none',
      },
    };

    return {
      inbounds: [{
        port: 10808,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
      }],
      outbounds: [outbound, { protocol: 'freedom', tag: 'direct' }],
    };
  }

  generateSingBoxConfig({ uuid, server, port, protocol = 'vmess' }) {
    const host = server.domain || server.ipAddress;
    return {
      log: { level: 'info' },
      dns: { servers: ['https://dns.google/dns-query'] },
      inbounds: [{
        type: 'socks',
        tag: 'socks-in',
        listen: '127.0.0.1',
        listen_port: 10808,
      }],
      outbounds: [{
        type: protocol,
        tag: 'proxy',
        server: host,
        server_port: port || server.port,
        uuid,
        security: 'auto',
      }],
    };
  }

  generateAllFormats({ uuid, server, port }) {
    return {
      vmess: this.generateVMessConfig({ uuid, server, port }),
      vless: this.generateVLESSConfig({ uuid, server, port }),
      trojan: this.generateTrojanConfig({ uuid, server, port }),
      v2rayJson: this.generateV2RayJSON({ uuid, server, port }),
      singBox: this.generateSingBoxConfig({ uuid, server, port }),
      qrCode: null,
    };
  }

  _generateSubscriptionLink(config, protocol) {
    if (protocol === 'vmess') {
      const base64 = Buffer.from(JSON.stringify(config)).toString('base64url');
      return `vmess://${base64}`;
    }
    return '';
  }

  generateUUID() {
    return crypto.randomUUID();
  }
}

export default new ConfigGeneratorService();
