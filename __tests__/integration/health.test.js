import { getApp, request } from '../../tests/helpers.js';

describe('Health Check', () => {
  it('GET /health returns ok', async () => {
    await getApp();
    const res = await request().get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /metrics returns prometheus format', async () => {
    await getApp();
    const res = await request().get('/metrics');
    expect(res.status).toBe(200);
    expect(typeof res.text).toBe('string');
  });
});
