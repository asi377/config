import { collectDefaultMetrics, register, Counter, Gauge, Histogram } from 'prom-client';

collectDefaultMetrics();

export async function metricsEndpoint(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const httpRequestsActive = new Gauge({
  name: 'http_requests_active',
  help: 'Currently in-flight HTTP requests',
});

export const nodeHealthScore = new Gauge({
  name: 'node_health_score',
  help: 'Health score of a VPN node (0-100)',
  labelNames: ['serverId'],
});

export const nodeActiveUsers = new Gauge({
  name: 'node_active_users',
  help: 'Number of active users on a VPN node',
  labelNames: ['serverId'],
});

export const nodeLoadPercent = new Gauge({
  name: 'node_load_percent',
  help: 'Load percentage reported by a VPN node',
  labelNames: ['serverId'],
});

export const nodeHeartbeatLatency = new Histogram({
  name: 'node_heartbeat_latency_seconds',
  help: 'Latency of node heartbeat round-trips in seconds',
  labelNames: ['serverId'],
});

export const queueJobCount = new Counter({
  name: 'queue_job_count',
  help: 'Number of jobs processed by a queue',
  labelNames: ['queue', 'status'],
});

export const queueJobDuration = new Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Duration of queue job processing in seconds',
  labelNames: ['queue'],
});

export const activeSubscriptions = new Gauge({
  name: 'active_subscriptions',
  help: 'Number of currently active subscriptions',
});

export const totalUsersGauge = new Gauge({
  name: 'total_users',
  help: 'Total number of registered users',
});

export const dailyRevenue = new Gauge({
  name: 'daily_revenue',
  help: 'Revenue collected today',
});

export const bandwidthUsedTotal = new Counter({
  name: 'bandwidth_used_total_bytes',
  help: 'Total bandwidth used across all subscriptions',
});

export const fraudEventsTotal = new Counter({
  name: 'fraud_events_total',
  help: 'Total fraud-rule trigger events',
  labelNames: ['severity', 'rule'],
});

export const fraudScore = new Gauge({
  name: 'fraud_score',
  help: 'Latest computed fraud score for a user',
  labelNames: ['user_id'],
});
