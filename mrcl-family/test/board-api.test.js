import test from 'node:test';
import assert from 'node:assert/strict';

import { describeFeeds, handleApi, parseFeeds } from '../src/board-api.mjs';
import { createStore } from '../src/store.mjs';

const WEEK = '2026-07-13';
const base = 'http://board.test';

async function freshStore() {
  // No connection string -> in-memory; no snapshot path -> isolated per test.
  return createStore(undefined, { snapshotPath: null });
}

function get(path) {
  return new Request(`${base}${path}`, { method: 'GET' });
}

function post(body) {
  return new Request(`${base}/api/board`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const call = async (request, options) => {
  const response = await handleApi(request, options);
  return { status: response.status, body: await response.json() };
};

/* ------------------------------------------------------------------- feeds */

test('parseFeeds reads a plain list and a JSON list', () => {
  assert.deepEqual(parseFeeds('https://a/x.ics, https://b/y.ics').map((f) => f.url), [
    'https://a/x.ics',
    'https://b/y.ics',
  ]);

  const rich = parseFeeds('[{"url":"https://a/x.ics","category":"sport","label":"Ruby"}]');
  assert.equal(rich[0].category, 'sport');
  assert.equal(rich[0].label, 'Ruby');
  assert.equal(rich[0].id, 0);
});

test('parseFeeds rejects anything that is not an https URL', () => {
  // Guards against the proxy being pointed at the host's own network.
  assert.deepEqual(parseFeeds('http://insecure/x.ics'), []);
  assert.deepEqual(parseFeeds('file:///etc/passwd'), []);
  assert.deepEqual(parseFeeds('http://169.254.169.254/latest/meta-data/'), []);
  assert.deepEqual(parseFeeds(''), []);
  assert.deepEqual(parseFeeds(undefined), []);
});

test('describeFeeds never leaks the address', () => {
  const feeds = parseFeeds('https://calendar.google.com/secret/basic.ics');
  const described = JSON.stringify(describeFeeds(feeds));
  assert.equal(described.includes('secret'), false);
  assert.deepEqual(describeFeeds(feeds), [{ id: 0, category: '', label: '' }]);
});

test('the calendar list endpoint answers with descriptors only', async () => {
  const feeds = parseFeeds('https://calendar.google.com/secret/basic.ics');
  const { status, body } = await call(get('/api/calendars'), { store: await freshStore(), feeds });
  assert.equal(status, 200);
  assert.deepEqual(body.calendars, [{ id: 0, category: '', label: '' }]);
});

test('an unknown feed index is refused', async () => {
  const { status } = await call(get('/api/calendar?feed=9'), { store: await freshStore(), feeds: [] });
  assert.equal(status, 404);
});

/* ------------------------------------------------------------------- board */

test('a new week reads back empty', async () => {
  const { status, body } = await call(get(`/api/board?week=${WEEK}`), { store: await freshStore(), feeds: [] });
  assert.equal(status, 200);
  assert.deepEqual(body.items, []);
  assert.deepEqual(body.ticks, {});
  assert.deepEqual(body.annual, []);
});

test('a week must be a real date', async () => {
  const options = { store: await freshStore(), feeds: [] };
  assert.equal((await call(get('/api/board?week=nonsense'), options)).status, 400);
  assert.equal((await call(get('/api/board'), options)).status, 400);
});

test('an item survives the round trip', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const added = await call(
    post({ op: 'add', week: WEEK, item: { title: 'Soccer', category: 'sport', date: '2026-07-16', time: '16:00' } }),
    options,
  );
  assert.equal(added.status, 201);
  assert.ok(added.body.id);

  const read = await call(get(`/api/board?week=${WEEK}`), options);
  assert.equal(read.body.items.length, 1);
  assert.equal(read.body.items[0].title, 'Soccer');
  assert.equal(read.body.items[0].time, '16:00');
  assert.ok(read.body.items[0].createdAt);
});

test('the server validates, not just the phone', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const bad = await call(post({ op: 'add', week: WEEK, item: { title: '   ', category: 'sport', date: '2026-07-16' } }), options);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /name/i);

  const badDate = await call(post({ op: 'add', week: WEEK, item: { title: 'x', category: 'sport', date: '2026-02-31' } }), options);
  assert.equal(badDate.status, 400);
});

test('an unknown category cannot be smuggled in', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const added = await call(
    post({ op: 'add', week: WEEK, item: { title: 'x', category: '<script>', date: '2026-07-16' } }),
    options,
  );
  // It is coerced to a safe default rather than stored as given.
  assert.equal(added.status, 400);
});

test('patch edits an item and keeps its id and creation time', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const { body: added } = await call(
    post({ op: 'add', week: WEEK, item: { title: 'Soccer', category: 'sport', date: '2026-07-16' } }),
    options,
  );

  const patched = await call(post({ op: 'patch', week: WEEK, id: added.id, patch: { done: true } }), options);
  assert.equal(patched.status, 200);
  assert.equal(patched.body.item.done, true);
  assert.equal(patched.body.item.id, added.id);
  assert.equal(patched.body.item.createdAt, added.item.createdAt);
  assert.equal(patched.body.item.title, 'Soccer');
});

test('patching something that is gone says so', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const missing = await call(post({ op: 'patch', week: WEEK, id: 'nope', patch: { done: true } }), options);
  assert.equal(missing.status, 404);
});

test('delete removes the item', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const { body: added } = await call(
    post({ op: 'add', week: WEEK, item: { title: 'Soccer', category: 'sport', date: '2026-07-16' } }),
    options,
  );
  assert.equal((await call(post({ op: 'delete', week: WEEK, id: added.id }), options)).status, 200);
  assert.deepEqual((await call(get(`/api/board?week=${WEEK}`), options)).body.items, []);
});

test('annual items are kept apart from any one week', async () => {
  const options = { store: await freshStore(), feeds: [] };
  await call(
    post({ op: 'add', week: WEEK, item: { title: 'Ruby', category: 'birthday', date: '2017-07-16', annual: true } }),
    options,
  );

  const thisWeek = await call(get(`/api/board?week=${WEEK}`), options);
  assert.equal(thisWeek.body.items.length, 0);
  assert.equal(thisWeek.body.annual.length, 1);

  // And they are there from any other week too.
  const otherWeek = await call(get('/api/board?week=2026-11-02'), options);
  assert.equal(otherWeek.body.annual.length, 1);
});

test('a calendar entry can be ticked off and un-ticked', async () => {
  const options = { store: await freshStore(), feeds: [] };
  await call(post({ op: 'tick', week: WEEK, key: 'ortho-1|2026-07-17', done: true }), options);
  assert.deepEqual((await call(get(`/api/board?week=${WEEK}`), options)).body.ticks, { 'ortho-1|2026-07-17': true });

  await call(post({ op: 'tick', week: WEEK, key: 'ortho-1|2026-07-17', done: false }), options);
  assert.deepEqual((await call(get(`/api/board?week=${WEEK}`), options)).body.ticks, {});
});

test('a tick needs a key', async () => {
  const options = { store: await freshStore(), feeds: [] };
  assert.equal((await call(post({ op: 'tick', week: WEEK, done: true }), options)).status, 400);
});

test('unknown operations and methods are refused', async () => {
  const options = { store: await freshStore(), feeds: [] };
  assert.equal((await call(post({ op: 'drop-everything' }), options)).status, 400);

  const put = await handleApi(new Request(`${base}/api/board`, { method: 'PUT' }), options);
  assert.equal(put.status, 405);
});

test('non-API paths fall through so files can be served', async () => {
  assert.equal(await handleApi(get('/'), { store: await freshStore(), feeds: [] }), null);
  assert.equal(await handleApi(get('/add'), { store: await freshStore(), feeds: [] }), null);
});

test('two weeks do not bleed into each other', async () => {
  const options = { store: await freshStore(), feeds: [] };
  await call(post({ op: 'add', week: WEEK, item: { title: 'This week', category: 'note', date: '2026-07-16' } }), options);
  await call(
    post({ op: 'add', week: '2026-07-20', item: { title: 'Next week', category: 'note', date: '2026-07-21' } }),
    options,
  );

  assert.deepEqual((await call(get(`/api/board?week=${WEEK}`), options)).body.items.map((i) => i.title), ['This week']);
  assert.deepEqual((await call(get('/api/board?week=2026-07-20'), options)).body.items.map((i) => i.title), ['Next week']);
});
