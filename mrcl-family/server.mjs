#!/usr/bin/env node
// The whole app in one process: the pages, the API, and the calendar proxy.
//
// Runs anywhere Node runs. On Render it is a single web service, which is why
// there is no second console to configure.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleApi, json, parseFeeds } from './src/board-api.mjs';
import { createStore } from './src/store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT) || 8080;

const feeds = parseFeeds(process.env.CALENDAR_ICS_URLS);

// An explicitly empty SNAPSHOT_PATH means "no local snapshot", which is what
// tests want; leaving it unset means "use the default location".
const rawSnapshot = process.env.SNAPSHOT_PATH;
const snapshotPath = rawSnapshot === undefined ? undefined : rawSnapshot.trim() || null;

const store = await createStore(process.env.REDIS_URL || process.env.KEY_VALUE_URL, { snapshotPath });

/* -------------------------------------------------------------------- auth */

// A shared key rather than per-person sign-in, on purpose. The kitchen screen
// has no keyboard and nobody is going to re-authenticate a TV every few weeks,
// so a link that stays signed in is the only thing that actually survives
// contact with a wall-mounted display.
//
// ALLOWED_EMAILS records who this is for. It is not enforced here — that would
// need a Google OAuth client id, which has to be created by hand in the Google
// Cloud console. See docs/DEPLOY.md.
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const COOKIE = 'mrcl_pass';
const TEN_YEARS = 60 * 60 * 24 * 3650;

function cookieValue() {
  return createHmac('sha256', ACCESS_KEY).update('mrcl-family-v1').digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(header, name) {
  return (header || '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];
}

/** -> null when allowed, or a Response when not. */
function gate(req, url) {
  if (!ACCESS_KEY) return null; // Unset means open, which is the local default.

  const supplied = url.searchParams.get('k');
  if (supplied && safeEqual(supplied, ACCESS_KEY)) {
    const clean = new URL(url);
    clean.searchParams.delete('k');
    return new Response(null, {
      status: 302,
      headers: {
        location: clean.pathname + clean.search,
        'set-cookie': `${COOKIE}=${cookieValue()}; Path=/; Max-Age=${TEN_YEARS}; HttpOnly; SameSite=Lax; Secure`,
      },
    });
  }

  if (safeEqual(readCookie(req.headers.cookie, COOKIE) || '', cookieValue())) return null;

  if (url.pathname.startsWith('/api/')) return json({ error: 'Not signed in.' }, 401);

  return new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
     <title>The MRCL family Week</title>
     <style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#eaf0f8;display:grid;place-items:center;
     min-height:100vh;margin:0;padding:1.5rem;text-align:center;line-height:1.5}p{color:#9fabba;max-width:26rem}</style>
     <div><h1>The MRCL family Week</h1><p>This board is for the family. Open it with the link that was sent to you —
     it only needs to be done once on each device.</p></div>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/* ------------------------------------------------------------ static files */

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

const LEGACY = { '/mobile-update.html': '/add', '/tv-display.html': '/' };

async function resolveFile(pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\.]+)/, '');
  const candidates = [join(root, relative), join(root, `${relative}.html`), join(root, relative, 'index.html')];

  for (const candidate of candidates) {
    if (!candidate.startsWith(root)) continue;
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

async function send(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  const body = response.body ? await response.text() : '';
  res.end(body);
}

/* ----------------------------------------------------------------- serving */

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    const blocked = gate(req, url);
    if (blocked) return await send(res, blocked);

    if (LEGACY[url.pathname]) {
      res.writeHead(301, { location: LEGACY[url.pathname] });
      return res.end();
    }

    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(`ok store=${store.backend} feeds=${feeds.length}`);
    }

    const body =
      req.method === 'POST'
        ? await new Promise((resolveBody) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
          })
        : undefined;

    const apiResponse = await handleApi(
      new Request(url, { method: req.method, body, headers: { 'content-type': 'application/json' } }),
      { store, feeds },
    );
    if (apiResponse) return await send(res, apiResponse);

    const file = await resolveFile(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }

    const cacheable = url.pathname.startsWith('/icons/');
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': cacheable ? 'public, max-age=604800' : 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    });
    res.end(await readFile(file));
  } catch (error) {
    console.error('[server]', error);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Something went wrong.');
  }
}).listen(port, () => {
  console.log(`[server] listening on ${port}`);
  console.log(`[server] store: ${store.backend}`);
  console.log(`[server] calendar feeds: ${feeds.length}`);
  console.log(`[server] access: ${ACCESS_KEY ? 'key required' : 'OPEN (no ACCESS_KEY set)'}`);
  if (!ACCESS_KEY) console.warn('[server] set ACCESS_KEY to lock the board down.');
});

// Printed only when asked for, so a key never lands in a build log by accident.
if (process.argv.includes('--suggest-key')) {
  console.log('suggested ACCESS_KEY:', randomBytes(24).toString('base64url'));
}
