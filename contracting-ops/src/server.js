import { createServer as createHttpServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { Router, HttpError, sendJson } from './lib/http.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerDashboardRoutes } from './routes/dashboard.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
const DEFAULT_DB = join(here, '..', 'data', 'ops.db');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

export function createApp({ dbFile = DEFAULT_DB } = {}) {
  const db = openDb(dbFile);
  const router = new Router();

  registerDashboardRoutes(router, db);
  registerClientRoutes(router, db);
  registerJobRoutes(router, db);
  router.get('/api/health', (req, res) => sendJson(res, 200, { ok: true, phase: 1 }));

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const matched = router.match(req.method, url.pathname);
        if (!matched) throw new HttpError(404, `No API route for ${url.pathname}`);
        await matched.handler(req, res, { params: matched.params, query: url.searchParams });
        return;
      }
      serveStatic(url.pathname, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(`${req.method} ${url.pathname}`, err);
      sendJson(res, status, {
        error: status >= 500 ? 'Internal server error' : err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
  });

  server.on('close', () => db.close());
  return { server, db };
}

function serveStatic(pathname, res) {
  const relative = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, relative);

  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    // Unknown paths fall back to the app shell so deep links keep working.
    const fallback = join(PUBLIC_DIR, 'index.html');
    res.writeHead(existsSync(fallback) ? 200 : 404, { 'content-type': MIME['.html'] });
    if (existsSync(fallback)) { createReadStream(fallback).pipe(res); return; }
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  const { server } = createApp({ dbFile: process.env.DB_FILE ?? DEFAULT_DB });
  server.listen(port, () => {
    console.log(`Contracting ops (phase 1) running at http://localhost:${port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
