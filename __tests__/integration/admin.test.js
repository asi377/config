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
    it('GET /api/admin/metrics returns 401 without auth', async () => {
      await getApp();
      const res = await request().get('/api/admin/metrics');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/servers returns 401 without auth', async () => {
      await getApp();
      const res = await request().get('/api/admin/servers');
      expect(res.status).toBe(401);
    });
  });
});
