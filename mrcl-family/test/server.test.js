import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Boot server.mjs on its own port and wait for it to say it is listening. */
async function boot(env = {}) {
  const port = 8100 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), SNAPSHOT_PATH: '', REDIS_URL: '', SELF_CHECK: 'off', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error('server did not start')), 10_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.on('exit', (code) => rejectReady(new Error(`server exited with ${code}`)));
  });

  const output = [];
  child.stdout.on('data', (chunk) => output.push(...chunk.toString().split('\n')));
  child.stderr.on('data', (chunk) => output.push(...chunk.toString().split('\n')));

  return {
    url: `http://localhost:${port}`,
    stop: () => child.kill(),
    /** Wait for `count` lines matching `pattern`, or time out. */
    async collect(pattern, count, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const matches = output.filter((line) => pattern.test(line));
        if (matches.length >= count) return matches;
        await new Promise((r) => setTimeout(r, 100));
      }
      return output.filter((line) => pattern.test(line));
    },
  };
}

test('it serves the board and the phone page', async (t) => {
  const server = await boot();
  t.after(() => server.stop());

  const board = await fetch(`${server.url}/`);
  assert.equal(board.status, 200);
  const html = await board.text();
  assert.match(html, /The MRCL family Week/);
  assert.match(html, /data-board/);

  // Extensionless paths work, so /add is a real URL.
  const add = await fetch(`${server.url}/add`);
  assert.equal(add.status, 200);
  assert.match(await add.text(), /data-quick/);
});

test('health says which store and how many feeds', async (t) => {
  const server = await boot();
  t.after(() => server.stop());

  const response = await fetch(`${server.url}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok store=memory feeds=0');
});

test('the previous version\'s URLs still work', async (t) => {
  const server = await boot();
  t.after(() => server.stop());

  const tv = await fetch(`${server.url}/tv-display.html`, { redirect: 'manual' });
  assert.equal(tv.status, 301);
  assert.equal(tv.headers.get('location'), '/');

  const phone = await fetch(`${server.url}/mobile-update.html`, { redirect: 'manual' });
  assert.equal(phone.status, 301);
  assert.equal(phone.headers.get('location'), '/add');
});

test('the API is wired up end to end', async (t) => {
  const server = await boot();
  t.after(() => server.stop());

  const empty = await (await fetch(`${server.url}/api/board?week=2026-07-13`)).json();
  assert.deepEqual(empty.items, []);

  const added = await fetch(`${server.url}/api/board`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      op: 'add',
      week: '2026-07-13',
      item: { title: 'Bins out', category: 'chore', date: '2026-07-14' },
    }),
  });
  assert.equal(added.status, 201);

  const read = await (await fetch(`${server.url}/api/board?week=2026-07-13`)).json();
  assert.deepEqual(read.items.map((i) => i.title), ['Bins out']);
});

test('calendar feeds are listed without their addresses', async (t) => {
  const server = await boot({ CALENDAR_ICS_URLS: 'https://calendar.google.com/ical/verysecret/basic.ics' });
  t.after(() => server.stop());

  assert.equal(await (await fetch(`${server.url}/healthz`)).text(), 'ok store=memory feeds=1');

  const body = await (await fetch(`${server.url}/api/calendars`)).text();
  assert.equal(body.includes('verysecret'), false);
  assert.deepEqual(JSON.parse(body).calendars, [{ id: 0, category: '', label: '' }]);
});

test('health is reachable without the key, and reveals nothing else', async (t) => {
  const server = await boot({ ACCESS_KEY: 'test-key-abcdef', CALENDAR_ICS_URLS: 'https://calendar.google.com/ical/verysecret/basic.ics' });
  t.after(() => server.stop());

  const response = await fetch(`${server.url}/healthz`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body, 'ok store=memory feeds=1');
  assert.equal(body.includes('verysecret'), false);
  assert.equal(body.includes('test-key'), false);
});

test('without ACCESS_KEY the board is open', async (t) => {
  const server = await boot();
  t.after(() => server.stop());
  assert.equal((await fetch(`${server.url}/`)).status, 200);
});

test('with ACCESS_KEY the board is shut until the link is used', async (t) => {
  const key = 'test-key-abcdef';
  const server = await boot({ ACCESS_KEY: key });
  t.after(() => server.stop());

  const shut = await fetch(`${server.url}/`);
  assert.equal(shut.status, 401);
  assert.match(await shut.text(), /link that was sent to you/);

  // The API is shut too, not just the pages.
  const api = await fetch(`${server.url}/api/board?week=2026-07-13`);
  assert.equal(api.status, 401);

  // A wrong key does not get in.
  assert.equal((await fetch(`${server.url}/?k=wrong`)).status, 401);
});

test('the link sets a cookie and then the key is never needed again', async (t) => {
  const key = 'test-key-abcdef';
  const server = await boot({ ACCESS_KEY: key });
  t.after(() => server.stop());

  const opened = await fetch(`${server.url}/?k=${key}`, { redirect: 'manual' });
  assert.equal(opened.status, 302);
  assert.equal(opened.headers.get('location'), '/');

  const cookie = opened.headers.get('set-cookie');
  assert.match(cookie, /mrcl_pass=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  // Ten years, so a wall-mounted screen is never logged out.
  assert.match(cookie, /Max-Age=315360000/);
  // The key itself is never the cookie value.
  assert.equal(cookie.includes(key), false);

  const expected = createHmac('sha256', key).update('mrcl-family-v1').digest('hex');
  const withCookie = await fetch(`${server.url}/`, { headers: { cookie: `mrcl_pass=${expected}` } });
  assert.equal(withCookie.status, 200);

  // A forged cookie does not work.
  const forged = await fetch(`${server.url}/`, { headers: { cookie: 'mrcl_pass=deadbeef' } });
  assert.equal(forged.status, 401);
});

test('the boot self-check reports every page as served', async (t) => {
  const server = await boot({ SELF_CHECK: 'on', ACCESS_KEY: 'test-key-abcdef' });
  t.after(() => server.stop());

  // Give the check a moment to run, then read what it logged.
  const lines = await server.collect(/self-check/, 5, 8000);
  assert.equal(lines.length, 5, lines.join(' | '));
  assert.equal(lines.every((l) => l.includes('ok ')), true, lines.join(' | '));
  assert.equal(lines.some((l) => l.includes('FAILED')), false, lines.join(' | '));
});

test('files outside public/ cannot be reached', async (t) => {
  const server = await boot();
  t.after(() => server.stop());

  for (const path of ['/../package.json', '/../../etc/passwd', '/%2e%2e/package.json']) {
    const response = await fetch(`${server.url}${path}`);
    assert.equal(response.status, 404, path);
  }
});
