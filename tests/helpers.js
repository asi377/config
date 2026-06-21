import supertest from 'supertest';
import { createApp, initializeDeps } from '../src/app.js';

let app;

export async function getApp() {
  if (!app) {
    // Try to initialize deps (DB, Redis, etc) but don't fail if unavailable
    try {
      await initializeDeps();
    } catch {
      // Tests work without real DB/Redis for most cases
    }
    app = await createApp();
  }
  return app;
}

export function request() {
  return supertest(app);
}

export { supertest };
