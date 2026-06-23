/**
 * XrayGrpcManager
 *
 * Manages Xray runtime state via its native gRPC API — no config.json
 * rewrites, no systemctl reload, no SIGHUP.  User mutations and traffic
 * stats are applied directly to the running process at zero cost.
 *
 * ── Services ──────────────────────────────────────────────────────────────
 *
 *   xray.app.proxyman.command.HandlerService → AlterInbound  (add / remove)
 *   xray.app.stats.command.StatsService      → GetStats      (traffic)
 *
 * ── Wire format ─────────────────────────────────────────────────────────────
 *
 * Xray wraps all payloads in TypedMessage { type, value } pairs, similar to
 * google.protobuf.Any but using Xray's own serial.TypedMessage.  The encode
 * chain for adding a user is:
 *
 *   Account  ──TypedMessage──►  User.account
 *   User     ──embedded in──►  AddUserOperation.user
 *   AddUserOperation ──TypedMessage──►  AlterInboundRequest.operation
 *
 * Account types (VLESS / Trojan / VMess) are defined as protobufjs schema
 * strings inside this file — you DON'T need their .proto files on disk.
 *
 * ── Proto files to download ────────────────────────────────────────────────
 *
 * Run:  ./scripts/download-protos.sh
 *
 * This downloads the 5 files needed by @grpc/proto-loader for the gRPC
 * service definitions:
 *
 *   app/proxyman/command/command.proto   ← HandlerService
 *   app/stats/command/command.proto      ← StatsService
 *   common/protocol/user.proto           ← User message (imported)
 *   common/serial/typed_message.proto    ← TypedMessage (imported)
 *   core/config.proto                    ← InboundHandlerConfig (imported)
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   import XrayGrpcManager from './services/XrayGrpcManager.js';
 *
 *   const xray = new XrayGrpcManager('127.0.0.1:10085');
 *   await xray.connect();
 *
 *   await xray.addUser('vless-in', 'alice@example.com', 'vless', uuid);
 *   await xray.removeUser('vless-in', 'alice@example.com');
 *   const { uplink, downlink } = await xray.queryUserStats('alice@example.com');
 *
 *   await xray.close();
 */

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import protobuf from 'protobufjs';
import path from 'path';
import { fileURLToPath } from 'url';

/* ── Paths & defaults ──────────────────────────────────────────────────────── */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '..', 'protos');

const LOAD_OPTS = {
  includeDirs: [PROTO_DIR],
  defaults: true,
  enums: String,
  keepCase: false,
  longs: Number,
  oneofs: true,
};

/* ── Account type definitions (inline protobufjs schemas) ────────────────── */

/**
 * Build a protobufjs Root with all account-related message types registered.
 * These are defined as schema *strings* so we don't need to download the
 * account .proto files and their deep import chains.
 */
function createAccountTypes() {
  const root = new protobuf.Root();

  // Must define TypedMessage BEFORE User references it.
  root.define('xray.common.serial')
    .add(new protobuf.Type('TypedMessage')
      .add(new protobuf.Field('type', 1, 'string'))
      .add(new protobuf.Field('value', 2, 'bytes')));

  // ── xray.common.protocol ──────────────────────────────────────────────

  root.define('xray.common.protocol')
    .add(new protobuf.Type('User')
      .add(new protobuf.Field('level', 1, 'uint32'))
      .add(new protobuf.Field('email', 2, 'string'))
      .add(new protobuf.Field('account', 3, 'xray.common.serial.TypedMessage')));

  // ── xray.proxy.vless ──────────────────────────────────────────────────

  root.define('xray.proxy.vless')
    .add(new protobuf.Type('Account')
      .add(new protobuf.Field('id', 1, 'string'))
      .add(new protobuf.Field('flow', 2, 'string'))
      .add(new protobuf.Field('encryption', 3, 'string')));

  // ── xray.proxy.trojan ─────────────────────────────────────────────────

  root.define('xray.proxy.trojan')
    .add(new protobuf.Type('Account')
      .add(new protobuf.Field('password', 1, 'string')));

  // ── xray.proxy.vmess ──────────────────────────────────────────────────

  // Enums must be registered before the type that uses them.
  root.define('xray.common.protocol')
    .add(new protobuf.Enum('SecurityType', {
      UNKNOWN: 0,
      AUTO: 2,
      AES128_GCM: 3,
      CHACHA20_POLY1305: 4,
      NONE: 5,
      ZERO: 6,
    }))
    .add(new protobuf.Type('SecurityConfig')
      .add(new protobuf.Field('type', 1, 'SecurityType')));

  root.define('xray.proxy.vmess')
    .add(new protobuf.Type('Account')
      .add(new protobuf.Field('id', 1, 'string'))
      .add(new protobuf.Field('security_settings', 3, 'xray.common.protocol.SecurityConfig'))
      .add(new protobuf.Field('tests_enabled', 4, 'string')));

  // ── xray.app.proxyman.command wrapper messages ────────────────────────

  root.define('xray.app.proxyman.command')
    .add(new protobuf.Type('AddUserOperation')
      .add(new protobuf.Field('user', 1, 'xray.common.protocol.User')))
    .add(new protobuf.Type('RemoveUserOperation')
      .add(new protobuf.Field('email', 1, 'string')));

  return root;
}

/* ── TypedMessage helpers ──────────────────────────────────────────────────── */

/**
 * Encode a protobuf message into a TypedMessage { type, value }.
 *
 * @param {protobuf.Message} message   The decoded protobuf message instance.
 * @param {protobuf.Type}    type      The protobufjs Type for this message.
 * @returns {{ type: string, value: Buffer }}
 */
function packAsTypedMessage(message, type) {
  const errMsg = type.verify(message);
  if (errMsg) throw new Error(`Validation error (${type.fullName}): ${errMsg}`);

  // protobufjs fullName includes a leading dot (e.g. ".xray.proxy.vless.Account");
  // Xray expects the Go protobuf FullName style without it.
  const name = type.fullName.startsWith('.') ? type.fullName.slice(1) : type.fullName;

  return {
    type: name,
    value: Buffer.from(type.encode(message).finish()),
  };
}

/* ── gRPC helpers ──────────────────────────────────────────────────────────── */

function getService(root, dotted) {
  let node = root;
  for (const segment of dotted.split('.')) {
    node = node?.[segment];
    if (!node) throw new Error(`gRPC service "${dotted}" not found — failed at "${segment}"`);
  }
  return node;
}

function callWithDeadline(client, method, request, sec) {
  return new Promise((resolve, reject) => {
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + sec);
    client[method](request, { deadline }, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

/* ── Account payload builders ──────────────────────────────────────────────── */

/**
 * Build the protocol-specific account payload for a given UUID.
 * Returns a plain object matching the inline protobuf schema.
 *
 * @param {string} protocol  "vless" | "trojan" | "vmess"
 * @param {string} uuid
 * @returns {object}
 */
function accountPayload(protocol, uuid) {
  switch (protocol) {
    case 'vless':
      return { id: uuid, flow: '', encryption: 'none' };
    case 'trojan':
      return { password: uuid };
    case 'vmess':
      return {
        id: uuid,
        security_settings: { type: 'AUTO' },
        tests_enabled: '',
      };
    default:
      throw new Error(`Unsupported protocol: "${protocol}". Use vless, trojan, or vmess.`);
  }
}

/* ── Class ──────────────────────────────────────────────────────────────────── */

class XrayGrpcManager {
  /**
   * @param {string} [grpcAddress]  Xray gRPC listen address (default 127.0.0.1:10085).
   * @param {object} [opts]
   * @param {number} [opts.deadline]  Default RPC timeout in seconds (default 10).
   */
  constructor(grpcAddress = '127.0.0.1:10085', opts = {}) {
    this._addr     = grpcAddress;
    this._deadline = opts.deadline ?? 10;
    this._handler  = null;
    this._stats    = null;
    this._types    = null;
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /**
   * Initialise protobuf types and open gRPC connections to the local Xray
   * instance.  Must be called once before any mutation or query methods.
   *
   * @throws {Error} If proto files are missing or the gRPC endpoint is unreachable.
   */
  async connect() {
    this._types = createAccountTypes();
    this._handler = this._initClient(
      'app/proxyman/command/command.proto',
      'xray.app.proxyman.command.HandlerService',
    );
    this._stats = this._initClient(
      'app/stats/command/command.proto',
      'xray.app.stats.command.StatsService',
    );
  }

  /**
   * Close both gRPC channels and release references.
   * Safe to call multiple times.
   */
  close() {
    this._handler?.close();
    this._stats?.close();
    this._handler = null;
    this._stats   = null;
    this._types   = null;
  }

  /* ── User management ───────────────────────────────────────────────────── */

  /**
   * Inject (or update) a user on a running Xray inbound.
   *
   * Wire chain:
   *   Account → TypedMessage → User.account →
   *   User → AddUserOperation → TypedMessage → AlterInbound.operation
   *
   * @param {string} inboundTag  Target inbound's tag (e.g. "vless-in").
   * @param {string} email       Unique user identifier.
   * @param {string} protocol    "vless" | "trojan" | "vmess"
   * @param {string} uuid        The user's secret (id / password).
   * @param {number} [level=0]   Policy level.
   * @returns {Promise<object>}
   */
  async addUser(inboundTag, email, protocol, uuid, level = 0) {
    this._guard();

    const accountType = this._types.lookupType(`xray.proxy.${protocol}.Account`);
    const accountPlain = accountPayload(protocol, uuid);
    const typedAccount = packAsTypedMessage(accountPlain, accountType);

    const userType = this._types.lookupType('xray.common.protocol.User');
    const userMsg = userType.fromObject({ level, email, account: typedAccount });

    const opType = this._types.lookupType('xray.app.proxyman.command.AddUserOperation');
    const opPlain = { user: userMsg.toJSON() };
    const typedOp = packAsTypedMessage(opPlain, opType);

    return this._rpc(this._handler, 'AlterInbound', {
      tag: inboundTag,
      operation: typedOp,
    });
  }

  /**
   * Remove a user from a running Xray inbound.
   *
   * Wire chain:
   *   RemoveUserOperation → TypedMessage → AlterInbound.operation
   *
   * @param {string} inboundTag
   * @param {string} email
   * @returns {Promise<object>}
   */
  async removeUser(inboundTag, email) {
    this._guard();

    const opType = this._types.lookupType('xray.app.proxyman.command.RemoveUserOperation');
    const opPlain = { email };
    const typedOp = packAsTypedMessage(opPlain, opType);

    return this._rpc(this._handler, 'AlterInbound', {
      tag: inboundTag,
      operation: typedOp,
    });
  }

  /* ── Traffic stats ─────────────────────────────────────────────────────── */

  /**
   * Query a user's cumulative traffic counters.
   *
   * Stat name format in Xray:
   *   user>>>{email}>>>traffic>>>{uplink|downlink}
   *
   * @param {string}  email
   * @param {boolean} [reset=false]  Atomically reset counters after reading.
   * @returns {Promise<{ uplink: number, downlink: number }>}
   */
  async queryUserStats(email, reset = false) {
    this._guard();

    const [uplink, downlink] = await Promise.all([
      this._getStat(`user>>>${email}>>>traffic>>>uplink`, reset),
      this._getStat(`user>>>${email}>>>traffic>>>downlink`, reset),
    ]);

    return { uplink, downlink };
  }

  /* ── Private ───────────────────────────────────────────────────────────── */

  _guard() {
    if (!this._handler || !this._stats || !this._types) {
      throw new Error('XrayGrpcManager not connected. Call await connect() first.');
    }
  }

  _rpc(client, method, request) {
    return callWithDeadline(client, method, request, this._deadline);
  }

  async _getStat(pattern, reset) {
    try {
      const res = await callWithDeadline(
        this._stats,
        'GetStats',
        { pattern, reset },
        Math.min(this._deadline, 5),
      );
      return res?.stat?.value ?? 0;
    } catch {
      return 0;
    }
  }

  _initClient(protoRelPath, serviceName) {
    const fullPath = path.resolve(PROTO_DIR, protoRelPath);
    const pkgDef = protoLoader.loadSync(fullPath, LOAD_OPTS);
    const proto  = grpc.loadPackageDefinition(pkgDef);
    const Ctor   = getService(proto, serviceName);
    return new Ctor(this._addr, grpc.credentials.createInsecure());
  }
}

export default XrayGrpcManager;
