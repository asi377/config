import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.BOT_TOKEN = 'test-bot-token-12345:test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long-for-testing';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars-long-for-test';
process.env.ADMIN_API_KEY = 'test-admin-api-key-for-testing';
process.env.NODE_SECRET = 'test-node-secret-at-least-16-chars';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vpn-panel-test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

jest.setTimeout(30000);
