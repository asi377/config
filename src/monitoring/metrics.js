import { collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics();

export function metricsEndpoint(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(register.metrics());
}
