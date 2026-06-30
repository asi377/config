import { getApp, request } from '../../tests/helpers.js';

describe('Admin API', () => {
  describe('Enterprise API authentication', () => {
    it('GET /api/enterprise/servers returns 401 without auth', async () => {
      await getApp();
      const res = await request().get('/api/enterprise/servers');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      await getApp();
      const res = await request()
        .get('/api/enterprise/servers')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
    });
  });

  describe('Internal admin API', () => {
    it('GET /api/admin-internal/metrics returns 401 without auth', async () => {
      await getApp();
      const res = await request().get('/api/admin-internal/metrics');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin-internal/servers returns 401 without auth', async () => {
      await getApp();
      const res = await request().get('/api/admin-internal/servers');
      expect(res.status).toBe(401);
    });
  });
});
