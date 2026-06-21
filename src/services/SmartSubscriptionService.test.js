/**
 * Unit tests for SmartSubscriptionService.
 *
 * Tests User-Agent detection + format generation in isolation (no DB/Redis).
 *
 * Jest ESM note: unstable_mockModule paths are resolved relative to the
 * *project root* (where jest.config.js lives), not relative to this test file.
 * We therefore use absolute-from-root paths that match what SmartSubscriptionService
 * itself imports.
 */

import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '../..');

// Helper: turn a src-relative path into the same string the module under
// test uses so Jest matches the right specifier.
const src = (rel) => rel; // SmartSubscriptionService uses bare relative imports

// ── Register mocks BEFORE any dynamic import of the real module ──────────────
jest.unstable_mockModule(
  path.join(ROOT, 'src/repositories/TunnelConfigRepository.js'),
  () => ({ default: { findByUuid: jest.fn() } }),
);
jest.unstable_mockModule(
  path.join(ROOT, 'src/repositories/SubscriptionRepository.js'),
  () => ({ default: { findById: jest.fn() } }),
);
jest.unstable_mockModule(
  path.join(ROOT, 'src/repositories/ServerRepository.js'),
  () => ({ default: { findActive: jest.fn() } }),
);
jest.unstable_mockModule(
  path.join(ROOT, 'src/services/infra/ConfigGeneratorService.js'),
  () => ({
    default: {
      generateVLESSConfig:  jest.fn(({ uuid, server, port }) => ({
        shareLink: `vless://${uuid}@${server.ipAddress}:${port}#test`,
      })),
      generateTrojanConfig: jest.fn(({ uuid, server, port }) => ({
        shareLink: `trojan://${uuid}@${server.ipAddress}:${port}#test`,
      })),
      generateVMessConfig: jest.fn(() => ({
        shareLink: 'vmess://eyJ0ZXN0IjoidGVzdCJ9',
      })),
    },
  }),
);
jest.unstable_mockModule(
  path.join(ROOT, 'src/config/logger.js'),
  () => ({ default: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }),
);

// ── Import module under test (must come after unstable_mockModule calls) ─────
const { default: service }    = await import('./SmartSubscriptionService.js');
const { default: TunnelRepo } = await import(path.join(ROOT, 'src/repositories/TunnelConfigRepository.js'));
const { default: SubRepo }    = await import(path.join(ROOT, 'src/repositories/SubscriptionRepository.js'));
const { default: ServerRepo } = await import(path.join(ROOT, 'src/repositories/ServerRepository.js'));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const UUID = 'aaaabbbb-cccc-dddd-eeee-ffffgggghhhh';

const ACTIVE_TUNNEL = {
  _id: 'tid1', uuid: UUID, subscriptionId: 'sid1',
  isActive: true, isGuestLink: false, isGuestExpired: false,
};
const ACTIVE_SUB  = { _id: 'sid1', planId: { title: 'VIP Plan' } };
const SERVERS     = [{
  _id: 'srv1', name: 'DE-01', ipAddress: '1.2.3.4',
  domain: 'de01.example.com', port: 443,
  status: 'active', healthStatus: 'healthy',
}];

function setupMocks() {
  TunnelRepo.findByUuid.mockResolvedValue(ACTIVE_TUNNEL);
  SubRepo.findById.mockResolvedValue(ACTIVE_SUB);
  ServerRepo.findActive.mockResolvedValue(SERVERS);
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('SmartSubscriptionService', () => {
  beforeEach(() => { jest.clearAllMocks(); setupMocks(); });

  // ── Guards ─────────────────────────────────────────────────────────────────
  describe('guard / null cases', () => {
    it('returns null when tunnel not found', async () => {
      TunnelRepo.findByUuid.mockResolvedValue(null);
      expect(await service.render('bad-uuid', 'ClashX/1.0')).toBeNull();
    });
    it('returns null when tunnel is inactive', async () => {
      TunnelRepo.findByUuid.mockResolvedValue({ ...ACTIVE_TUNNEL, isActive: false });
      expect(await service.render(UUID, 'ClashX/1.0')).toBeNull();
    });
    it('returns null when guest link is expired', async () => {
      TunnelRepo.findByUuid.mockResolvedValue({ ...ACTIVE_TUNNEL, isGuestLink: true, isGuestExpired: true });
      expect(await service.render(UUID, '')).toBeNull();
    });
    it('returns null when no healthy servers', async () => {
      ServerRepo.findActive.mockResolvedValue([]);
      expect(await service.render(UUID, 'ClashX/1.0')).toBeNull();
    });
  });

  // ── Clash ──────────────────────────────────────────────────────────────────
  describe('Clash format', () => {
    test.each(['ClashX/1.4.0', 'clash-verge/1.5.0', 'CLASH-META', 'Stash/2.4 Clash/1.18'])(
      'detects Clash from "%s"', async (ua) => {
        const r = await service.render(UUID, ua);
        expect(r?.format).toBe('clash');
        expect(r?.contentType).toMatch('text/yaml');
      },
    );

    it('YAML body has required sections and server entries', async () => {
      const { body } = await service.render(UUID, 'ClashX/1.4.0');
      expect(body).toMatch(/^proxies:/m);
      expect(body).toMatch(/^proxy-groups:/m);
      expect(body).toMatch(/^rules:/m);
      expect(body).toContain('DE-01');
      expect(body).toContain('vless');
      expect(body).toContain('trojan');
      expect(body).toContain('DE-01-vless');
      expect(body).toContain('DE-01-trojan');
    });
  });

  // ── Sing-box ───────────────────────────────────────────────────────────────
  describe('Sing-box format', () => {
    test.each(['sing-box/1.8.0', 'SFI/1.0 sing-box/1.9', 'SingBox/2.0'])(
      'detects Sing-box from "%s"', async (ua) => {
        const r = await service.render(UUID, ua);
        expect(r?.format).toBe('singbox');
        expect(r?.contentType).toMatch('application/json');
      },
    );

    it('Sing-box JSON has correct structure', async () => {
      const { body } = await service.render(UUID, 'sing-box/1.9.0');
      const p = JSON.parse(body);
      expect(p).toHaveProperty('log');
      expect(p).toHaveProperty('dns');
      expect(p).toHaveProperty('inbounds');
      expect(p).toHaveProperty('outbounds');
      expect(p).toHaveProperty('route');
      const tags = p.outbounds.map(o => o.tag);
      expect(tags).toContain('DE-01-vless');
      expect(tags).toContain('DE-01-trojan');
    });
  });

  // ── Base64 fallback ────────────────────────────────────────────────────────
  describe('Base64 fallback', () => {
    test.each(['', 'Mozilla/5.0 (Windows NT 10.0)', 'curl/7.88.1', 'python-requests/2.28'])(
      'uses Base64 for "%s"', async (ua) => {
        const r = await service.render(UUID, ua);
        expect(r?.format).toBe('base64');
        expect(r?.contentType).toMatch('text/plain');
      },
    );

    it('decoded body contains valid share-link URIs', async () => {
      const { body } = await service.render(UUID, 'Mozilla/5.0');
      const lines = Buffer.from(body, 'base64').toString('utf-8').split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach(line => expect(line).toMatch(/^(vless|trojan|vmess):\/\//));
    });
  });
});
