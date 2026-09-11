import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { Router, HttpError, sendJson } from './lib/http.js';
import { userForToken, readCookie } from './lib/auth.js';
import { uploadsDir } from './lib/uploads.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerExpenseRoutes } from './routes/expenses.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
const DATA_DIR = join(here, '..', 'data');
const DEFAULT_DB = join(DATA_DIR, 'ops.db');

// Endpoints reachable without a session. Everything else requires one.
const PUBLIC_ROUTES = new Set([
  'GET /api/health', 'GET /api/auth/status', 'POST /api/auth/login',
  'POST /api/auth/setup', 'POST /api/auth/logout',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
    + "script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

export function createApp({ dbFile = DEFAULT_DB, dataDir = DATA_DIR, tls = null, secureCookies = Boolean(tls) } = {}) {
  const db = openDb(dbFile);
  const uploadDir = uploadsDir(dataDir);
  const router = new Router();

  registerAuthRoutes(router, db, { secureCookies });
  registerDashboardRoutes(router, db);
  registerClientRoutes(router, db);
  registerJobRoutes(router, db);
  registerExpenseRoutes(router, db, { uploadDir });
  router.get('/api/health', (req, res) => sendJson(res, 200, { ok: true, phase: 2 }));

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);

    try {
      if (!url.pathname.startsWith('/api/')) {
        serveStatic(url.pathname, res);
        return;
      }

      const matched = router.match(req.method, url.pathname);
      if (!matched) throw new HttpError(404, `No API route for ${url.pathname}`);

      const user = userForToken(db, readCookie(req, 'session'));
      if (!user && !PUBLIC_ROUTES.has(`${req.method} ${url.pathname}`)) {
        throw new HttpError(401, 'Not signed in');
      }

      await matched.handler(req, res, { params: matched.params, query: url.searchParams, user });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(`${req.method} ${url.pathname}`, err);
      if (res.headersSent) { res.destroy(); return; }
      sendJson(res, status, {
        error: status >= 500 ? 'Internal server error' : err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
  };

  const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
  server.on('close', () => db.close());
  return { server, db, uploadDir };
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

/** Every IPv4 address the box answers on, so the phone URL is printed at startup. */
function lanAddresses() {
  return Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '0.0.0.0';
  const certPath = process.env.TLS_CERT;
  const keyPath = process.env.TLS_KEY;

  const tls = certPath && keyPath
    ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    : null;

  const { server } = createApp({
    dbFile: process.env.DB_FILE ?? DEFAULT_DB,
    tls,
    secureCookies: Boolean(tls) || process.env.COOKIE_SECURE === '1',
  });

  server.listen(port, host, () => {
    const scheme = tls ? 'https' : 'http';
    console.log(`Contracting Ops (phase 2) listening on ${host}:${port}`);
    console.log(`  this box:   ${scheme}://localhost:${port}`);
    for (const address of lanAddresses()) console.log(`  your phone: ${scheme}://${address}:${port}`);
    if (!tls && host !== '127.0.0.1') {
      console.log('  note: serving over plain HTTP. Keep this on your home network only.');
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
