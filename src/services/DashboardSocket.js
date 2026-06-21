import { WebSocketServer } from 'ws';
import logger from '../config/logger.js';
import EventBus from '../events/EventBus.js';

class DashboardSocket {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.authenticatedClients = new Set();
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws/dashboard' });

    this.wss.on('connection', (ws, _req) => {
      logger.info('[ws] Dashboard client connected');

      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth' && msg.token) {
            ws.authenticated = true;
            this.authenticatedClients.add(ws);
            ws.send(JSON.stringify({ type: 'auth', status: 'ok' }));
          }
        } catch { /* ignore malformed */ }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.authenticatedClients.delete(ws);
      });

      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'connected', message: 'HORNET Dashboard real-time' }));
    });

    this._startHeartbeat();
    this._subscribeEvents();
    logger.info('[ws] Dashboard WebSocket attached');
  }

  broadcast(event, data) {
    const msg = JSON.stringify({ type: event, data, timestamp: Date.now() });
    for (const ws of this.authenticatedClients) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch { /* skip */ }
      }
    }
  }

  _startHeartbeat() {
    setInterval(() => {
      for (const ws of this.wss?.clients || []) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      }
    }, 30000);
  }

  _subscribeEvents() {
    const events = [
      'server:heartbeat', 'server:health_degraded', 'server:offline',
      'subscription:created', 'subscription:renewed', 'subscription:expired',
      'payment:approved', 'payment:received',
      'fraud:detected', 'fraud:user_suspended',
      'lb:migration_completed', 'lb:region_blackout',
      'job:completed', 'job:failed',
    ];

    for (const event of events) {
      EventBus.on(event, (data) => this.broadcast(event, data));
    }

    logger.info({ eventCount: events.length }, '[ws] Subscribed to events');
  }

  broadcastMetrics(metrics) {
    this.broadcast('metrics:update', metrics);
  }
}

export default new DashboardSocket();
