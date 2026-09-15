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
  assert.deepEqual(body.repeating, []);
  assert.deepEqual(body.shopping, []);
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

test('repeating items are kept apart from any one week', async () => {
  const options = { store: await freshStore(), feeds: [] };
  await call(
    post({ op: 'add', week: WEEK, item: { title: 'Ruby', category: 'birthday', date: '2017-07-16', repeat: 'annual' } }),
    options,
  );
  await call(
    post({ op: 'add', week: WEEK, item: { title: 'Bins out', category: 'chore', date: '2026-07-14', repeat: 'weekly' } }),
    options,
  );

  const thisWeek = await call(get(`/api/board?week=${WEEK}`), options);
  assert.equal(thisWeek.body.items.length, 0);
  assert.equal(thisWeek.body.repeating.length, 2);

  // And they are there from any other week too.
  const otherWeek = await call(get('/api/board?week=2026-11-02'), options);
  assert.equal(otherWeek.body.repeating.length, 2);
});

test('a repeating item is edited in its own bucket', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const { body: added } = await call(
    post({ op: 'add', week: WEEK, item: { title: 'Bins out', category: 'chore', date: '2026-07-14', repeat: 'weekly' } }),
    options,
  );

  const patched = await call(
    post({ op: 'patch', repeating: true, id: added.id, patch: { title: 'Bins and recycling' } }),
    options,
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.body.item.title, 'Bins and recycling');
  assert.equal(patched.body.item.repeat, 'weekly');

  await call(post({ op: 'delete', repeating: true, id: added.id }), options);
  assert.deepEqual((await call(get(`/api/board?week=${WEEK}`), options)).body.repeating, []);
});

/* --------------------------------------------------------------- shopping */

test('the shopping list survives the round trip', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const added = await call(post({ op: 'shopping-add', item: { title: 'Milk' } }), options);
  assert.equal(added.status, 201);

  const read = await call(get(`/api/board?week=${WEEK}`), options);
  assert.deepEqual(read.body.shopping.map((i) => i.title), ['Milk']);
  assert.equal(read.body.shopping[0].done, false);
});

test('a shopping item needs a name', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const bad = await call(post({ op: 'shopping-add', item: { title: '  ' } }), options);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /what do we need/i);
});

test('adding the same thing twice revives it rather than duplicating', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const { body: first } = await call(post({ op: 'shopping-add', item: { title: 'Milk' } }), options);
  await call(post({ op: 'shopping-toggle', id: first.id, done: true }), options);

  // Somebody adds milk again without noticing it is already ticked.
  await call(post({ op: 'shopping-add', item: { title: 'milk' } }), options);

  const read = await call(get(`/api/board?week=${WEEK}`), options);
  assert.equal(read.body.shopping.length, 1);
  assert.equal(read.body.shopping[0].done, false);
});

test('ticking off and clearing the trolley', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const { body: milk } = await call(post({ op: 'shopping-add', item: { title: 'Milk' } }), options);
  await call(post({ op: 'shopping-add', item: { title: 'Bread' } }), options);

  await call(post({ op: 'shopping-toggle', id: milk.id, done: true }), options);
  let read = await call(get(`/api/board?week=${WEEK}`), options);
  assert.equal(read.body.shopping.find((i) => i.title === 'Milk').done, true);
  assert.equal(read.body.shopping.length, 2, 'ticked off, not removed');

  const cleared = await call(post({ op: 'shopping-clear-bought' }), options);
  assert.equal(cleared.body.remaining, 1);

  read = await call(get(`/api/board?week=${WEEK}`), options);
  assert.deepEqual(read.body.shopping.map((i) => i.title), ['Bread']);
});

test('a shopping item can be removed outright', async () => {
  const options = { store: await freshStore(), feeds: [] };
  const { body: milk } = await call(post({ op: 'shopping-add', item: { title: 'Milk' } }), options);
  await call(post({ op: 'shopping-delete', id: milk.id }), options);
  assert.deepEqual((await call(get(`/api/board?week=${WEEK}`), options)).body.shopping, []);
});

test('toggling something that is not there needs an id', async () => {
  const options = { store: await freshStore(), feeds: [] };
  assert.equal((await call(post({ op: 'shopping-toggle', done: true }), options)).status, 400);
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
