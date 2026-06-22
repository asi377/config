/**
 * Unit tests — Node Coefficient feature in UsageService.trackUsage
 *
 * Covers: coefficient multiplication, Math.round safety, fallback to 1.0,
 * backward-compatibility (no serverId), quota suspension, and batch API.
 */

import { jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockSub = {
  _id: 'sub1',
  status: 'active',
  usedVolumeBytes: 0,
  totalVolumeBytes: 10 * 1073741824, // 10 GB
  notified80Percent: false,
  ownerId: 'user1',
  save: jest.fn().mockResolvedValue(true),
};

const mockServer = (coefficient) => ({ _id: 'srv1', coefficient });

jest.unstable_mockModule(path.join(ROOT, 'src/repositories/SubscriptionRepository.js'), () => ({
  default: { findById: jest.fn() },
}));
jest.unstable_mockModule(path.join(ROOT, 'src/repositories/ServerRepository.js'), () => ({
  default: { findById: jest.fn() },
}));
jest.unstable_mockModule(path.join(ROOT, 'src/repositories/UserRepository.js'), () => ({
  default: {},
}));
jest.unstable_mockModule(path.join(ROOT, 'src/repositories/TunnelConfigRepository.js'), () => ({
  default: {},
}));
jest.unstable_mockModule(path.join(ROOT, 'src/events/EventBus.js'), () => ({
  default: { emit: jest.fn() },
}));
jest.unstable_mockModule(path.join(ROOT, 'src/config/logger.js'), () => ({
  default: {
    info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

const { default: UsageService }    = await import('./UsageService.js');
const { default: SubRepo }         = await import(path.join(ROOT, 'src/repositories/SubscriptionRepository.js'));
const { default: ServerRepo }      = await import(path.join(ROOT, 'src/repositories/ServerRepository.js'));
const { default: EventBus }        = await import(path.join(ROOT, 'src/events/EventBus.js'));

// ── Helpers ───────────────────────────────────────────────────────────────────
function freshSub(overrides = {}) {
  return {
    ...mockSub,
    usedVolumeBytes: 0,
    notified80Percent: false,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('UsageService.trackUsage — coefficient', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Backward-compatibility ──────────────────────────────────────────────
  describe('no serverId (backward-compatible)', () => {
    it('uses coefficient 1.0 when serverId is omitted', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);

      const result = await UsageService.trackUsage('sub1', 1000);

      expect(sub.usedVolumeBytes).toBe(1000);          // 1000 * 1.0 = 1000
      expect(result.chargedBytes).toBe(1000);
      expect(ServerRepo.findById).not.toHaveBeenCalled(); // no DB hit for server
    });

    it('uses coefficient 1.0 when serverId is null', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);

      const result = await UsageService.trackUsage('sub1', 500, null);

      expect(sub.usedVolumeBytes).toBe(500);
      expect(result.chargedBytes).toBe(500);
    });
  });

  // ── Normal coefficient application ──────────────────────────────────────
  describe('coefficient > 1.0 (premium server)', () => {
    it('charges 1.5× for a premium server', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockResolvedValue(mockServer(1.5));

      const result = await UsageService.trackUsage('sub1', 1_000_000, 'srv1');

      expect(result.chargedBytes).toBe(1_500_000);     // 1 000 000 * 1.5
      expect(sub.usedVolumeBytes).toBe(1_500_000);
      expect(result.action).toBe('ok');
    });

    it('charges 2× for a high-premium server', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockResolvedValue(mockServer(2.0));

      const result = await UsageService.trackUsage('sub1', 500_000, 'srv1');

      expect(result.chargedBytes).toBe(1_000_000);
      expect(sub.usedVolumeBytes).toBe(1_000_000);
    });
  });

  describe('coefficient < 1.0 (discounted server)', () => {
    it('charges 0.5× for a cheap/local server', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockResolvedValue(mockServer(0.5));

      const result = await UsageService.trackUsage('sub1', 2_000_000, 'srv1');

      expect(result.chargedBytes).toBe(1_000_000);
      expect(sub.usedVolumeBytes).toBe(1_000_000);
    });
  });

  describe('coefficient = 1.0 (standard server)', () => {
    it('charges exact bytes when coefficient is 1.0', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockResolvedValue(mockServer(1.0));

      const result = await UsageService.trackUsage('sub1', 777_777, 'srv1');

      expect(result.chargedBytes).toBe(777_777);
      expect(sub.usedVolumeBytes).toBe(777_777);
    });
  });

  // ── Math.round safety ────────────────────────────────────────────────────
  describe('floating-point safety via Math.round', () => {
    it('rounds fractional bytes to nearest integer', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);
      // 3 * 1.3 = 3.8999999... → Math.round → 4
      ServerRepo.findById.mockResolvedValue(mockServer(1.3));

      const result = await UsageService.trackUsage('sub1', 3, 'srv1');

      // Raw: 3 * 1.3 = 3.9 → Math.round → 4
      expect(result.chargedBytes).toBe(4);
      expect(Number.isInteger(sub.usedVolumeBytes)).toBe(true);
    });

    it('never accumulates floating-point drift across multiple calls', async () => {
      // 1 byte * coefficient 1.1, called 10 times
      // Without rounding: 10 * 1.1 = 11.000000000000002 (fp drift)
      // With Math.round each call: Math.round(1.1) = 1, total = 10
      ServerRepo.findById.mockResolvedValue(mockServer(1.1));

      let totalCharged = 0;
      for (let i = 0; i < 10; i++) {
        const sub = freshSub({ usedVolumeBytes: totalCharged });
        SubRepo.findById.mockResolvedValue(sub);
        const r = await UsageService.trackUsage('sub1', 1, 'srv1');
        totalCharged = sub.usedVolumeBytes;
        expect(Number.isInteger(r.chargedBytes)).toBe(true);
      }
      expect(Number.isInteger(totalCharged)).toBe(true);
    });
  });

  // ── Fallback when server fetch fails ─────────────────────────────────────
  describe('fallback on server fetch error', () => {
    it('falls back to 1.0 coefficient when ServerRepo throws', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockRejectedValue(new Error('DB timeout'));

      const result = await UsageService.trackUsage('sub1', 1_000, 'srv-bad');

      // Should not throw, should charge exactly 1000 (coefficient 1.0 fallback)
      expect(result.action).toBe('ok');
      expect(result.chargedBytes).toBe(1_000);
      expect(sub.usedVolumeBytes).toBe(1_000);
    });

    it('falls back to 1.0 when server has null coefficient', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockResolvedValue({ _id: 'srv1', coefficient: null });

      const result = await UsageService.trackUsage('sub1', 2_000, 'srv1');

      expect(result.chargedBytes).toBe(2_000);
    });

    it('falls back to 1.0 when server has coefficient 0 (guard)', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockResolvedValue({ _id: 'srv1', coefficient: 0 });

      const result = await UsageService.trackUsage('sub1', 2_000, 'srv1');

      expect(result.chargedBytes).toBe(2_000); // 0 is falsy → fallback 1.0
    });
  });

  // ── Quota enforcement ────────────────────────────────────────────────────
  describe('quota enforcement with coefficient', () => {
    it('suspends subscription when coefficient pushes usage to 100%', async () => {
      const totalBytes = 1_000_000;
      const sub = freshSub({ totalVolumeBytes: totalBytes, usedVolumeBytes: 800_000 });
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockResolvedValue(mockServer(2.0));

      // 200000 raw * 2.0 = 400000 charged → 800000 + 400000 = 1200000 > total → capped + suspended
      const result = await UsageService.trackUsage('sub1', 200_000, 'srv1');

      expect(result.action).toBe('suspended');
      expect(sub.status).toBe('suspended');
      expect(sub.usedVolumeBytes).toBe(totalBytes); // capped at total
      expect(EventBus.emit).toHaveBeenCalledWith(
        'subscription:quota_exhausted',
        expect.objectContaining({ subscriptionId: 'sub1' }),
      );
    });

    it('emits 80% warning when coefficient-charged bytes cross the threshold', async () => {
      const totalBytes = 1_000_000;
      const sub = freshSub({ totalVolumeBytes: totalBytes, usedVolumeBytes: 700_000 });
      SubRepo.findById.mockResolvedValue(sub);
      ServerRepo.findById.mockResolvedValue(mockServer(1.5));

      // 100000 * 1.5 = 150000 → 700000 + 150000 = 850000 = 85% → warning
      const result = await UsageService.trackUsage('sub1', 100_000, 'srv1');

      expect(result.action).toBe('warning');
      expect(result.usagePercent).toBeCloseTo(85, 0);
      expect(EventBus.emit).toHaveBeenCalledWith(
        'subscription:usage_warning',
        expect.objectContaining({ subscriptionId: 'sub1' }),
      );
    });
  });

  // ── Batch API ────────────────────────────────────────────────────────────
  describe('trackUsageBatch with serverId', () => {
    it('passes serverId to each trackUsage call', async () => {
      SubRepo.findById
        .mockResolvedValueOnce(freshSub({ _id: 'subA' }))
        .mockResolvedValueOnce(freshSub({ _id: 'subB' }));
      ServerRepo.findById
        .mockResolvedValueOnce(mockServer(1.5))  // for subA
        .mockResolvedValueOnce(mockServer(0.5)); // for subB

      const results = await UsageService.trackUsageBatch([
        { subscriptionId: 'subA', bytesUsed: 1_000_000, serverId: 'srvA' },
        { subscriptionId: 'subB', bytesUsed: 1_000_000, serverId: 'srvB' },
      ]);

      expect(results[0].chargedBytes).toBe(1_500_000); // 1.5×
      expect(results[1].chargedBytes).toBe(500_000);   // 0.5×
    });

    it('batch entry without serverId defaults to 1.0', async () => {
      const sub = freshSub();
      SubRepo.findById.mockResolvedValue(sub);

      const results = await UsageService.trackUsageBatch([
        { subscriptionId: 'sub1', bytesUsed: 999 }, // no serverId
      ]);

      expect(results[0].chargedBytes).toBe(999);
      expect(ServerRepo.findById).not.toHaveBeenCalled();
    });
  });

  // ── Skipped subscription ─────────────────────────────────────────────────
  it('skips tracking for non-active subscriptions', async () => {
    SubRepo.findById.mockResolvedValue({ ...freshSub(), status: 'expired' });

    const result = await UsageService.trackUsage('sub1', 500, 'srv1');

    expect(result.action).toBe('skipped');
    expect(ServerRepo.findById).not.toHaveBeenCalled(); // no wasted DB query
  });
});
