import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server.js';
import { signIn } from './helpers.js';

let server;
let base;
let workDir;

let cookie;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'contracting-ops-'));
  ({ server } = createApp({ dbFile: join(workDir, 'test.db'), dataDir: workDir }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn(base, { username: 'mike', display_name: 'Mike', password: 'correct horse battery' });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
});

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

describe('clients', () => {
  test('rejects a client with no name', async () => {
    const res = await api('POST', '/api/clients', { phone: '555-0100' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /"name" is required/);
  });

  test('creates, reads, updates and searches clients', async () => {
    const created = await api('POST', '/api/clients', {
      name: 'Dana Whitfield', phone: '555-0143', email: 'dana@example.com', address: '12 Oak St',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Dana Whitfield');

    const patched = await api('PATCH', `/api/clients/${created.body.id}`, { phone: '555-9999' });
    assert.equal(patched.body.phone, '555-9999');

    const found = await api('GET', '/api/clients?search=Whitfield');
    assert.equal(found.body.length, 1);
    assert.equal(found.body[0].job_count, 0);

    const missing = await api('GET', '/api/clients/99999');
    assert.equal(missing.status, 404);
  });
});

describe('jobs', () => {
  let clientId;

  before(async () => {
    const res = await api('POST', '/api/clients', { name: 'Ruiz Property Group' });
    clientId = res.body.id;
  });

  test('creates a job with a job number and an opening timeline entry', async () => {
    const res = await api('POST', '/api/jobs', {
      client_id: clientId, title: 'Kitchen remodel', site_address: '44 Pine Ave', priority: 'high',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'lead');
    assert.match(res.body.job_number, /^J-\d{4}$/);
    assert.equal(res.body.client_name, 'Ruiz Property Group');

    const detail = await api('GET', `/api/jobs/${res.body.id}`);
    assert.equal(detail.body.events.length, 1);
    assert.equal(detail.body.events[0].kind, 'created');
  });

  test('rejects an unknown client_id and a missing title', async () => {
    assert.equal((await api('POST', '/api/jobs', { title: 'Deck', client_id: 4242 })).status, 400);
    assert.equal((await api('POST', '/api/jobs', { client_id: clientId })).status, 400);
  });

  test('rejects a malformed start_date', async () => {
    const res = await api('POST', '/api/jobs', { title: 'Roof', start_date: '02/03/2026' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /YYYY-MM-DD/);
  });

  test('rejects an impossible calendar date', async () => {
    const res = await api('POST', '/api/jobs', { title: 'Roof', start_date: '2026-02-31' });
    assert.equal(res.status, 400);
  });

  test('walks a job through the workflow and records every move', async () => {
    const { body: job } = await api('POST', '/api/jobs', { title: 'Bathroom gut', client_id: clientId });

    for (const [status, note] of [
      ['estimating', 'Measured on site'],
      ['bid_sent', 'Emailed the bid'],
      ['scheduled', 'Signed, starts the 14th'],
      ['in_progress', 'Demo started'],
      ['punch_list', 'Trim and touch-up left'],
      ['complete', 'Walked through with owner'],
    ]) {
      const res = await api('POST', `/api/jobs/${job.id}/status`, { status, note, author: 'Mike' });
      assert.equal(res.status, 200, `expected ${status} to be accepted`);
      assert.equal(res.body.status, status);
    }

    const detail = await api('GET', `/api/jobs/${job.id}`);
    const changes = detail.body.events.filter((e) => e.kind === 'status_change');
    assert.equal(changes.length, 6);
    assert.equal(changes[0].to_status, 'complete');
    assert.equal(changes[0].from_status, 'punch_list');
    assert.equal(changes[0].author, 'Mike');
  });

  test('refuses an illegal status jump and explains what is allowed', async () => {
    const { body: job } = await api('POST', '/api/jobs', { title: 'Fence line' });
    const res = await api('POST', `/api/jobs/${job.id}/status`, { status: 'complete' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.details.allowed, ['estimating', 'bid_sent', 'scheduled', 'cancelled']);

    const unchanged = await api('GET', `/api/jobs/${job.id}`);
    assert.equal(unchanged.body.status, 'lead');
    assert.equal(unchanged.body.events.length, 1, 'a rejected move must not leave a timeline entry');
  });

  test('treats a same-status move as a logged no-op', async () => {
    const { body: job } = await api('POST', '/api/jobs', { title: 'Garage slab' });
    const res = await api('POST', `/api/jobs/${job.id}/status`, { status: 'lead', note: 'Still chasing' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'lead');
  });

  test('rejects an unknown status value', async () => {
    const { body: job } = await api('POST', '/api/jobs', { title: 'Siding' });
    const res = await api('POST', `/api/jobs/${job.id}/status`, { status: 'finished' });
    assert.equal(res.status, 400);
  });

  test('sends status changes through the workflow endpoint, not PATCH', async () => {
    const { body: job } = await api('POST', '/api/jobs', { title: 'Window swap' });
    const res = await api('PATCH', `/api/jobs/${job.id}`, { status: 'scheduled' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /POST \/api\/jobs\/:id\/status/);
  });

  test('adds notes to the timeline', async () => {
    const { body: job } = await api('POST', '/api/jobs', { title: 'Porch rebuild' });
    const note = await api('POST', `/api/jobs/${job.id}/events`, { body: 'Lumber delivered', author: 'Mike' });
    assert.equal(note.status, 201);
    assert.equal(note.body.kind, 'note');

    const empty = await api('POST', `/api/jobs/${job.id}/events`, { body: '   ' });
    assert.equal(empty.status, 400);

    const events = await api('GET', `/api/jobs/${job.id}/events`);
    assert.equal(events.body.length, 2);
  });

  test('filters by status, group, client and free text', async () => {
    const byGroup = await api('GET', '/api/jobs?group=pipeline');
    assert.ok(byGroup.body.length > 0);
    assert.ok(byGroup.body.every((j) => ['lead', 'estimating', 'bid_sent'].includes(j.status)));

    const byClient = await api('GET', `/api/jobs?client_id=${clientId}`);
    assert.ok(byClient.body.every((j) => j.client_id === clientId));

    const bySearch = await api('GET', '/api/jobs?search=Porch');
    assert.equal(bySearch.body.length, 1);

    assert.equal((await api('GET', '/api/jobs?status=nonsense')).status, 400);
  });

  test('keeps jobs when their client is deleted', async () => {
    const { body: client } = await api('POST', '/api/clients', { name: 'Temporary Owner' });
    const { body: job } = await api('POST', '/api/jobs', { title: 'Shed pad', client_id: client.id });

    assert.equal((await api('DELETE', `/api/clients/${client.id}`)).status, 200);
    const after = await api('GET', `/api/jobs/${job.id}`);
    assert.equal(after.status, 200);
    assert.equal(after.body.client_id, null);
  });

  test('deleting a job removes its timeline', async () => {
    const { body: job } = await api('POST', '/api/jobs', { title: 'Scratch job' });
    await api('POST', `/api/jobs/${job.id}/events`, { body: 'note' });
    assert.equal((await api('DELETE', `/api/jobs/${job.id}`)).status, 200);
    assert.equal((await api('GET', `/api/jobs/${job.id}`)).status, 404);
  });
});

describe('dashboard', () => {
  test('buckets jobs and surfaces upcoming starts', async () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const { body: job } = await api('POST', '/api/jobs', { title: 'Driveway pour', start_date: soon });
    await api('POST', `/api/jobs/${job.id}/status`, { status: 'scheduled' });

    const res = await api('GET', '/api/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.body.totals.active >= 1);
    assert.ok(res.body.by_status.some((s) => s.key === 'scheduled' && s.count >= 1));
    assert.ok(res.body.upcoming.some((u) => u.id === job.id));
    assert.ok(res.body.recent.length > 0);
    assert.equal(res.body.stale.length, 0, 'nothing created in this run should be stale yet');
  });
});

describe('plumbing', () => {
  test('reports health and workflow metadata', async () => {
    assert.deepEqual((await api('GET', '/api/health')).body, { ok: true, phase: 3 });
    const meta = await api('GET', '/api/meta');
    assert.equal(meta.body.statuses.length, 8);
    assert.deepEqual(meta.body.priorities, ['low', 'normal', 'high']);
  });

  test('returns 404 for unknown API routes and 405 for the wrong method', async () => {
    assert.equal((await api('GET', '/api/nope')).status, 404);
    assert.equal((await api('DELETE', '/api/dashboard')).status, 405);
  });

  test('rejects a body that is not a JSON object', async () => {
    const res = await fetch(`${base}/api/clients`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '"just a string"',
    });
    assert.equal(res.status, 400);
  });
});
