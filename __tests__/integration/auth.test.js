import { getApp, request } from '../../tests/helpers.js';
import { startMongo, stopMongo } from '../../tests/mongoHelper.js';
import mongoose from 'mongoose';

let hasMongo = false;

describe('Auth API', () => {
  beforeAll(async () => {
    const uri = await startMongo();
    if (uri) {
      hasMongo = true;
      await mongoose.connect(uri);
      // Create a test admin
      const Admin = (await import('../../src/models/Admin.js')).default;
      await Admin.create({
        email: 'admin@test.com',
        password: '$2a$10$test',
        displayName: 'Test Admin',
        role: 'superadmin',
        isActive: true,
      });
    }
  });

  afterAll(async () => {
    if (hasMongo) {
      await mongoose.disconnect();
      await stopMongo();
    }
  });

  describe('POST /api/auth/login', () => {
    it('returns 400 for missing credentials', async () => {
      await getApp();
      const res = await request().post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('returns 401 for wrong password', async () => {
      if (!hasMongo) return; // skip if no DB
      await getApp();
      const res = await request().post('/api/auth/login').send({
        email: 'admin@test.com',
        password: 'wrong',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without token', async () => {
      await getApp();
      const res = await request().get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });
});
