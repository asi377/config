import crypto from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import logger from '../../config/logger.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import redisClient from '../../redis/client.js';
const NODE_ROOM_PREFIX = 'node:';

/**
 * Singleton WebSocket server for agent-node communication.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────
 * 1. Agent sets `auth: { nodeToken }` in its socket.io handshake.
 * 2. Server middleware validates the token against ServerRepository.
 * 3. On success, the socket joins a private room `node:{_id}`.
 *
 * ── Dispatch ──────────────────────────────────────────────────────────────
 *   dispatchTaskToNode(nodeId, taskType, payload, timeout?)
 *     → emits `command` to the node's room
 *     → agent emits back `command:ack`
 *     → resolves / rejects the returned Promise
 *
 * ── Scaling ───────────────────────────────────────────────────────────────
 * When a Redis client is available, a socket.io Redis adapter is attached
 * so any backend instance can reach any connected agent.
 */
class WSServer {
  constructor() {
    this._io = null;
    this._nodes = new Map();       // nodeId → Set<socketId>
    this._socketToNode = new Map(); // socketId → nodeId
    this._pendingAcks = new Map();  // commandId → { resolve, reject, timer }
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /**
   * Attach the Socket.IO server to an existing HTTP server.
   * Must be called once during app bootstrap.
   *
   * @param {import('http').Server} httpServer
   * @param {object}                [opts]   Overrides for default socket.io options.
   */
  attach(httpServer, opts = {}) {
    if (this._io) {
      logger.warn('[WSServer] Already attached — skipping duplicate attach');
      return;
    }

    this._io = new SocketIOServer(httpServer, {
      path: '/ws/agent',
      pingInterval: 25000,
      pingTimeout: 20000,
      maxHttpBufferSize: 1 << 20, // 1 MB
      ...opts,
    });

    this._attachRedisAdapter();
    this._io.use(this._authMiddleware.bind(this));
    this._io.on('connection', this._onConnection.bind(this));

    logger.info('[WSServer] Agent WebSocket attached at /ws/agent');
  }

  /**
   * Graceful shutdown — reject all pending commands and close the server.
   */
  close() {
    for (const [cmdId, pending] of this._pendingAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WSServer shutting down'));
    }
    this._pendingAcks.clear();
    this._nodes.clear();
    this._socketToNode.clear();
    this._io?.close();
    this._io = null;
    logger.info('[WSServer] Closed');
  }

  /* ── Public API ──────────────────────────────────────────────────────────── */

  /**
   * Dispatch a command to a specific node and wait for acknowledgment.
   *
   * @param {string}  nodeId        MongoDB _id of the target server.
   * @param {string}  type          Command type (e.g. "addUser", "restartXray").
   * @param {object}  payload       Arbitrary JSON payload for the command.
   * @param {number}  [timeout=30_000]  Max ms to wait before rejecting.
   * @returns {Promise<object>} Resolves with the agent's ack payload.
   *
   * @throws {Error} If the node is offline or the command times out.
   */
  dispatchTaskToNode(nodeId, type, payload, timeout = 30_000) {
    return new Promise((resolve, reject) => {
      if (!this._io) {
        return reject(new Error('[WSServer] Not attached — call attach() first'));
      }

      const room = `${NODE_ROOM_PREFIX}${nodeId}`;
      const sockets = this._io.sockets.adapter.rooms.get(room);
      if (!sockets || sockets.size === 0) {
        return reject(new Error(`Node ${nodeId} is offline (no connected socket)`));
      }

      const commandId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

      const timer = setTimeout(() => {
        this._pendingAcks.delete(commandId);
        reject(new Error(`Command ${commandId} timed out after ${timeout}ms`));
      }, timeout);

      this._pendingAcks.set(commandId, { resolve, reject, timer });

      this._io.to(room).emit('command', { commandId, type, payload });
    });
  }

  /**
   * Return the _id strings of all currently connected nodes.
   * @returns {string[]}
   */
  getConnectedNodes() {
    return Array.from(this._nodes.keys());
  }

  /**
   * Check whether a given node has at least one active socket.
   * @param {string} nodeId
   * @returns {boolean}
   */
  isNodeConnected(nodeId) {
    const sockets = this._nodes.get(nodeId);
    return !!sockets && sockets.size > 0;
  }

  /* ── Internals ──────────────────────────────────────────────────────────── */

  /** Optionally attach a Redis adapter for cross-instance scaling. */
  _attachRedisAdapter() {
    if (!redisClient.connected) return;

    try {
      const pub = redisClient.getClient();
      const sub = redisClient.getSubscriber();
      if (!pub || !sub) return;
      this._io.adapter(createAdapter(pub, sub));
      logger.info('[WSServer] Redis adapter attached — multi-instance mode');
    } catch (err) {
      logger.warn({ err }, '[WSServer] Redis adapter unavailable — single-instance only');
    }
  }

  /**
   * socket.io middleware — validates nodeToken against ServerRepository.
   * Rejects with a 401-compatible error if the token is missing or invalid.
   */
  async _authMiddleware(socket, next) {
    const nodeToken =
      socket.handshake.auth?.nodeToken ||
      (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');

    if (!nodeToken) {
      return next(new Error('NODE_TOKEN_REQUIRED'));
    }

    try {
      const server = await ServerRepository.findOne({ nodeToken });
      if (!server) {
        return next(new Error('NODE_TOKEN_INVALID'));
      }
      socket.data.nodeId = String(server._id);
      socket.data.nodeToken = nodeToken;
      next();
    } catch (err) {
      logger.error({ err }, '[WSServer] Auth middleware error');
      next(new Error('AUTH_SERVICE_ERROR'));
    }
  }

  /** Handle a newly authenticated connection. */
  _onConnection(socket) {
    const nodeId = socket.data.nodeId;
    logger.info({ nodeId, socketId: socket.id, ip: socket.handshake.address }, '[WSServer] Agent connected');

    this._registerSocket(nodeId, socket.id);
    socket.join(`${NODE_ROOM_PREFIX}${nodeId}`);

    socket.on('command:ack', (data, cb) => this._handleAck(data, cb));
    socket.on('node:metrics', (data) => this._handleMetrics(nodeId, data));
    socket.on('disconnect', (reason) => this._onDisconnect(nodeId, socket.id, reason));
  }

  _registerSocket(nodeId, socketId) {
    if (!this._nodes.has(nodeId)) {
      this._nodes.set(nodeId, new Set());
    }
    this._nodes.get(nodeId).add(socketId);
    this._socketToNode.set(socketId, nodeId);
  }

  _unregisterSocket(nodeId, socketId) {
    this._socketToNode.delete(socketId);
    const sockets = this._nodes.get(nodeId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) this._nodes.delete(nodeId);
    }
  }

  _onDisconnect(nodeId, socketId, reason) {
    logger.info({ nodeId, socketId, reason }, '[WSServer] Agent disconnected');
    this._unregisterSocket(nodeId, socketId);
  }

  /**
   * Handle a command acknowledgment from an agent.
   * Both callback-style and event-based acknowledgments are supported.
   */
  _handleAck(data, callback) {
    const { commandId, success, result, error } = data || {};
    if (!commandId) {
      callback?.({ error: 'MISSING_COMMAND_ID' });
      return;
    }

    const pending = this._pendingAcks.get(commandId);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingAcks.delete(commandId);
      if (success) {
        pending.resolve(result ?? {});
      } else {
        pending.reject(new Error(error || 'Command failed'));
      }
    }

    callback?.({ received: true });
  }

  /**
   * Relay real-time metrics to the dashboard monitor room.
   */
  _handleMetrics(nodeId, data) {
    this._io?.to('dashboard:monitors').emit('node:metrics', { nodeId, ...data });
  }
}

// ---------------------------------------------------------------------------
// Singleton — import this in app.js and call wsServer.attach(httpServer)
// ---------------------------------------------------------------------------
const wsServer = new WSServer();
export default wsServer;
export { WSServer };
