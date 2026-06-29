import { collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics();

export async function metricsEndpoint(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}
