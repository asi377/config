/**
 * WSClient — WebSocket agent for receiving commands from the central backend.
 *
 * Replaces the HTTP heartbeat polling loop for command delivery while keeping
 * the existing health/metrics heartbeat as a side-channel.
 *
 * ── Reconnection ──────────────────────────────────────────────────────────
 * Built-in exponential backoff via socket.io:
 *   initial delay:  1s
 *   max delay:     30s
 *   randomization:  0.3
 *   max attempts:   Infinity (keep trying forever)
 *
 * ── Command flow ──────────────────────────────────────────────────────────
 *   Server emits:   { commandId, type, payload }
 *   Agent executes: executeCommand(type, payload)   ← caller registers handlers
 *   Agent ack:      emits 'command:ack' with { commandId, success, result/error }
 *
 * ── Fallback ──────────────────────────────────────────────────────────────
 * If WebSocket cannot connect after the initial attempt, an 'fallback' event
 * is emitted so the caller can fall back to HTTP polling.
 */

import { io as createSocket } from 'socket.io-client';

const DEFAULT_OPTIONS = {
  path: '/ws/agent',
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.3,
  timeout: 20_000,
  transports: ['websocket', 'polling'],
};

class WSClient {
  /**
   * @param {object}   config
   * @param {string}   config.backendUrl   Backend HTTP URL (e.g. http://panel.example.com:3000)
   * @param {string}   config.nodeToken    NODE_TOKEN for authentication
   * @param {object}   [config.socketOpts] Additional socket.io client options
   */
  constructor(config) {
    this._config = config;
    this._socket = null;
    this._registered = false;
    this._shutdown = false;
    this._handlerMap = new Map();   // type → async (payload) => result

    // Callbacks
    this._onConnect = null;
    this._onDisconnect = null;
    this._onFallback = null;
    this._onError = null;
    this._connectionAttempts = 0;
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /**
   * Initiate the WebSocket connection.
   * The socket.io client manages reconnection automatically.
   */
  connect() {
    if (this._socket?.connected) return;

    this._shutdown = false;

    const wsUrl = this._config.backendUrl.replace(/^http/, 'ws');

    this._socket = createSocket(wsUrl, {
      ...DEFAULT_OPTIONS,
      ...this._config.socketOpts,
      auth: { nodeToken: this._config.nodeToken },
    });

    this._socket.on('connect', () => {
      this._connectionAttempts = 0;
      this._registered = true;
      this._onConnect?.(this._socket.id);
    });

    this._socket.on('disconnect', (reason) => {
      this._registered = false;
      this._onDisconnect?.(reason);

      if (reason === 'io server disconnect' && !this._shutdown) {
        // Server explicitly closed the connection — reconnect manually
        this._socket?.connect();
      }
    });

    this._socket.on('connect_error', (err) => {
      this._connectionAttempts++;
      this._onError?.(err);

      // If the very first attempt fails (not a reconnect), fire fallback
      if (this._connectionAttempts === 1) {
        this._onFallback?.(err);
      }
    });

    this._socket.on('command', this._handleCommand.bind(this));
  }

  /**
   * Gracefully disconnect.  No reconnection will be attempted after this.
   */
  disconnect() {
    this._shutdown = true;
    this._socket?.disconnect();
    this._socket = null;
    this._registered = false;
  }

  /* ── Handler registration ──────────────────────────────────────────────── */

  /**
   * Register a command handler.
   *
   * @param {string}   type     Command type (e.g. 'addUser', 'restartXray').
   * @param {Function} handler  Async function (payload) => result.
   */
  on(type, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for "${type}" must be a function`);
    }
    this._handlerMap.set(type, handler);
  }

  /**
   * Remove a previously registered handler.
   */
  off(type) {
    this._handlerMap.delete(type);
  }

  /* ── Connection state callbacks ─────────────────────────────────────────── */

  onConnect(fn) { this._onConnect = fn; }
  onDisconnect(fn) { this._onDisconnect = fn; }
  onFallback(fn) { this._onFallback = fn; }
  onError(fn) { this._onError = fn; }

  /* ── Queries ────────────────────────────────────────────────────────────── */

  get connected() {
    return this._socket?.connected ?? false;
  }

  get id() {
    return this._socket?.id ?? null;
  }

  /* ── Internal ───────────────────────────────────────────────────────────── */

  /**
   * Handle an incoming command from the server:
   *   1. Look up the handler by type.
   *   2. Execute it.
   *   3. Emit 'command:ack' with the result.
   */
  async _handleCommand(data) {
    const { commandId, type, payload } = data || {};

    if (!commandId || !type) {
      // Malformed — acknowledge with error so the server doesn't hang
      this._socket?.emit('command:ack', {
        commandId: commandId ?? 'unknown',
        success: false,
        error: 'MALFORMED_COMMAND',
      });
      return;
    }

    const handler = this._handlerMap.get(type);

    if (!handler) {
      this._socket?.emit('command:ack', {
        commandId,
        success: false,
        error: `UNKNOWN_COMMAND_TYPE: ${type}`,
      });
      return;
    }

    try {
      const result = await handler(payload);
      this._socket?.emit('command:ack', {
        commandId,
        success: true,
        result: result ?? null,
      });
    } catch (err) {
      this._socket?.emit('command:ack', {
        commandId,
        success: false,
        error: err.message || 'HANDLER_ERROR',
      });
    }
  }
}

export default WSClient;
