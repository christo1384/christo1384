#!/usr/bin/env node
// A local preview server, so `npm run dev` needs no install and no Netlify CLI.
// Serves public/ and answers /api/calendar with the same function Netlify runs.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ics': 'text/calendar; charset=utf-8',
};

const calendarFn = (await import('../netlify/functions/calendar.mjs')).default;
// The real board function needs Netlify Blobs; locally we use the in-memory
// stand-in so `npm run dev` works with no cloud resources at all.
const boardFn = (await import('./dev-board.mjs')).default;

async function resolveFile(pathname) {
  // Strip the leading slash and any attempt to climb out of public/.
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\.]+)/, '');
  const candidates = [join(root, relative), join(root, `${relative}.html`), join(root, relative, 'index.html')];

  for (const candidate of candidates) {
    if (!candidate.startsWith(root)) continue;
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === '/api/board') {
    const body = req.method === 'POST' ? await new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }) : undefined;
    const response = await boardFn(new Request(url, { method: req.method, body, headers: { 'content-type': 'application/json' } }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    return;
  }

  if (url.pathname === '/api/calendar') {
    const response = await calendarFn(new Request(url, { method: req.method }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    return;
  }

  // Mirrors the redirects in netlify.toml for the previous version's pages.
  const legacy = { '/mobile-update.html': '/add', '/tv-display.html': '/' };
  if (legacy[url.pathname]) {
    res.writeHead(301, { location: legacy[url.pathname] });
    res.end();
    return;
  }

  const file = await resolveFile(url.pathname === '/' ? '/index.html' : url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(await readFile(file));
}).listen(port, () => {
  console.log(`The board:     http://localhost:${port}/`);
  console.log(`The phone page: http://localhost:${port}/add`);
});
