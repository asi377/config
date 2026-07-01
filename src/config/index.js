import 'dotenv/config';

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  botToken: process.env.BOT_TOKEN,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vpn-panel',
  proxyUrl: process.env.PROXY_URL,
  adminApiKey: process.env.ADMIN_API_KEY,
  smsSecret: process.env.SMS_SECRET,
  channelId: process.env.CHANNEL_ID,
  webhookUrl: process.env.WEBHOOK_URL,
  cardNumber: process.env.CARD_NUMBER || '6037998192480597',
  // Public base URL used to build subscription links delivered to clients.
  // BASE_URL is the canonical name; BACKEND_URL is kept for backward compat.
  // In production this MUST be a publicly reachable URL (VPS IP or domain),
  // e.g. https://your-domain.com — a private 172.x/192.168.x IP only works for
  // devices on the same LAN (see docs/NETWORKING.md).
  backendUrl: process.env.BASE_URL || process.env.BACKEND_URL
    || `http://localhost:${parseInt(process.env.PORT, 10) || 3000}`,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  logLevel: process.env.LOG_LEVEL || 'info',
  infra: {
    heartbeatTimeout: parseInt(process.env.HEARTBEAT_TIMEOUT || '90'),
    failureThreshold: parseInt(process.env.FAILURE_THRESHOLD || '3'),
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60'),
    loadThreshold: parseInt(process.env.LOAD_THRESHOLD || '80'),
    criticalThreshold: parseInt(process.env.CRITICAL_THRESHOLD || '90'),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-refresh-in-production',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  ws: {
    agentPath: process.env.WS_AGENT_PATH || '/ws/agent',
    commandTimeout: parseInt(process.env.WS_COMMAND_TIMEOUT || '30000', 10),
    maxBufferSize: parseInt(process.env.WS_MAX_BUFFER_SIZE || '1048576', 10),
  },
  internalSubSecret: process.env.INTERNAL_SUB_SECRET,
  nodeSecret: process.env.NODE_SECRET || 'change-me-node-secret',
  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    prefix: process.env.REDIS_PREFIX || 'hornet:',
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@hornet.com',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    enabled: !!process.env.STRIPE_SECRET_KEY,
  },
  cryptomus: {
    apiKey: process.env.CRYPTOMUS_API_KEY,
    merchantId: process.env.CRYPTOMUS_MERCHANT_ID,
    webhookSecret: process.env.CRYPTOMUS_WEBHOOK_SECRET,
  },
};

const required = ['botToken', 'jwt.secret', 'adminApiKey', 'nodeSecret'];
for (const key of required) {
  const val = key.includes('.') ? key.split('.').reduce((o, k) => o?.[k], config) : config[key];
  if (!val || val === 'change-me-in-production' || val === 'change-me-refresh-in-production') {
    throw new Error(`Missing or insecure default for required environment variable: ${key.toUpperCase()}`);
  }
}

if (config.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

if (config.jwt.refreshSecret.length < 32) {
  throw new Error('JWT_REFRESH_SECRET must be at least 32 characters');
}

if (!config.nodeSecret || config.nodeSecret === 'change-me-node-secret' || config.nodeSecret.length < 16) {
  throw new Error('NODE_SECRET must be at least 16 characters and not the default value');
}

export default config;
