import http from 'http';
import { log } from './logger';

let watchHealthy = false;

export function setWatchHealthy(healthy: boolean): void {
  watchHealthy = healthy;
}

export function startHealthServer(port: number = 9091): http.Server {
  const server = http.createServer((_req, res) => {
    if (_req.url === '/healthz') {
      const status = watchHealthy ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: watchHealthy ? 'ok' : 'degraded',
        watch: watchHealthy,
        uptime: process.uptime(),
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    log.info('health.start', `Health server on :${port}`);
  });

  return server;
}
