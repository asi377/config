import { getApp, request } from '../../tests/helpers.js';

describe('Node API', () => {
  describe('POST /api/nodes/register', () => {
    it('returns 401 without auth', async () => {
      await getApp();
      const res = await request().post('/api/nodes/register').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/nodes/heartbeat', () => {
    it('returns 401 without auth', async () => {
      await getApp();
      const res = await request().post('/api/nodes/heartbeat').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/nodes', () => {
    it('returns 401 without auth', async () => {
      await getApp();
      const res = await request().get('/api/nodes');
      expect(res.status).toBe(401);
    });
  });
});
