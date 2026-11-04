import http from 'node:http';
import { logger } from './logger.js';

/**
 * Máy chủ HTTP siêu nhẹ (không phụ thuộc thư viện ngoài) dành cho các nền tảng Cloud PaaS
 * như Render, Railway, Koyeb, Fly.io yêu cầu cổng kiểm tra sức khỏe (Health Check).
 *
 * @param {object} options
 * @param {number | null} options.port
 * @param {() => object} options.getStatus
 * @returns {http.Server | null}
 */
export function startHealthServer({ port, getStatus }) {
  if (port === null || port === undefined) return null;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health' || req.url === '/healthz')) {
      const payload = JSON.stringify({
        ok: true,
        service: 'discord-mention-antispam-bot',
        timestamp: new Date().toISOString(),
        ...(typeof getStatus === 'function' ? getStatus() : {}),
      });

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(payload);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
  });

  server.on('error', (err) => {
    logger.error('HealthServer', 'Lỗi máy chủ HTTP Healthcheck', err);
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info('HealthServer', `HTTP Healthcheck đang lắng nghe tại 0.0.0.0:${port}`);
  });

  return server;
}
