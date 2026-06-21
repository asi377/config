import promClient from 'prom-client';

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register, prefix: 'hornet_' });

// HTTP metrics
export const httpRequestDuration = new promClient.Histogram({
  name: 'hornet_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsTotal = new promClient.Counter({
  name: 'hornet_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestsActive = new promClient.Gauge({
  name: 'hornet_http_requests_active',
  help: 'Currently active HTTP requests',
  registers: [register],
});

// Node metrics
export const nodeHealthScore = new promClient.Gauge({
  name: 'hornet_node_health_score',
  help: 'Health score per node (0-100)',
  labelNames: ['node_id', 'region'],
  registers: [register],
});

export const nodeActiveUsers = new promClient.Gauge({
  name: 'hornet_node_active_users',
  help: 'Active users per node',
  labelNames: ['node_id', 'region'],
  registers: [register],
});

export const nodeLoadPercent = new promClient.Gauge({
  name: 'hornet_node_load_percent',
  help: 'Load percentage per node',
  labelNames: ['node_id'],
  registers: [register],
});

export const nodeHeartbeatLatency = new promClient.Histogram({
  name: 'hornet_node_heartbeat_latency_ms',
  help: 'Node heartbeat latency in ms',
  labelNames: ['node_id'],
  buckets: [50, 100, 200, 500, 1000, 2000],
  registers: [register],
});

// Queue metrics
export const queueJobCount = new promClient.Gauge({
  name: 'hornet_queue_job_count',
  help: 'Job count per queue and status',
  labelNames: ['queue', 'status'],
  registers: [register],
});

export const queueJobDuration = new promClient.Histogram({
  name: 'hornet_queue_job_duration_seconds',
  help: 'Job processing duration in seconds',
  labelNames: ['queue', 'job_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

// Business metrics
export const activeSubscriptions = new promClient.Gauge({
  name: 'hornet_active_subscriptions',
  help: 'Total active subscriptions',
  registers: [register],
});

export const totalUsersGauge = new promClient.Gauge({
  name: 'hornet_total_users',
  help: 'Total registered users',
  registers: [register],
});

export const dailyRevenue = new promClient.Gauge({
  name: 'hornet_daily_revenue',
  help: 'Daily revenue in IRR',
  registers: [register],
});

export const bandwidthUsedTotal = new promClient.Counter({
  name: 'hornet_bandwidth_used_bytes_total',
  help: 'Total bandwidth used in bytes',
  labelNames: ['node_id'],
  registers: [register],
});

// Abuse detection
export const fraudEventsTotal = new promClient.Counter({
  name: 'hornet_fraud_events_total',
  help: 'Total fraud detection events',
  labelNames: ['severity', 'rule'],
  registers: [register],
});

export const fraudScore = new promClient.Gauge({
  name: 'hornet_fraud_score',
  help: 'Current fraud score per user',
  labelNames: ['user_id'],
  registers: [register],
});

export async function metricsEndpoint(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

export default register;
