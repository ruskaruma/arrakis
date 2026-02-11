import http from 'http';
import { Registry, Gauge, Histogram, Counter, collectDefaultMetrics } from 'prom-client';
import { log } from './logger';

const register = new Registry();
collectDefaultMetrics({ register });

export const storesGauge = new Gauge({
  name: 'arrakis_stores_total',
  help: 'Number of stores by phase',
  labelNames: ['phase'] as const,
  registers: [register],
});

export const provisionDuration = new Histogram({
  name: 'arrakis_provision_duration_seconds',
  help: 'Time from store creation to Ready phase',
  buckets: [30, 60, 120, 180, 300, 600],
  registers: [register],
});

export const reconcileErrors = new Counter({
  name: 'arrakis_reconcile_errors_total',
  help: 'Total reconciliation errors',
  labelNames: ['phase'] as const,
  registers: [register],
});

export const reconcileDuration = new Histogram({
  name: 'arrakis_reconcile_duration_seconds',
  help: 'Duration of a single reconcile call',
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120],
  registers: [register],
});

let watchHealthy = false;

export function setWatchHealthy(healthy: boolean): void {
  watchHealthy = healthy;
}

export function startMetricsServer(port: number = 9091): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') {
      const status = watchHealthy ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: watchHealthy ? 'ok' : 'degraded',
        watch: watchHealthy,
        uptime: process.uptime(),
      }));
      return;
    }

    if (req.url === '/metrics') {
      try {
        const metrics = await register.metrics();
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.end(metrics);
      } catch (err: any) {
        res.writeHead(500);
        res.end(err.message);
      }
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    log.info('metrics.start', `Metrics server on :${port}`);
  });

  return server;
}
