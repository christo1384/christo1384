// The board's own store, on Netlify Blobs.
//
// This replaces Firebase entirely. The family's calendar is the source of
// truth for anything that belongs in a calendar; what lives here is the
// residue that does not — "home late", what's for dinner, and which things
// have been ticked off.
//
// One blob per week keeps writes small and self-contained, and old weeks age
// out on their own. Every write is a compare-and-set against the entry's ETag,
// so two phones editing the same week at the same moment cannot silently
// overwrite each other.

import { getStore } from '@netlify/blobs';

import { validateItem } from '../../public/js/item.js';

const STORE = 'mrcl-family';
const ANNUAL_KEY = 'annual';
const MAX_WRITE_ATTEMPTS = 5;
const MAX_ITEMS_PER_WEEK = 200;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_WEEK = { items: [], ticks: {} };

function store() {
  return getStore(STORE);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function weekKey(week) {
  return `week/${week}`;
}

function newId() {
  return `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Read a JSON blob with its ETag, tolerating a missing entry. */
async function read(key, fallback) {
  const result = await store().getWithMetadata(key, { type: 'json' });
  if (!result) return { value: structuredClone(fallback), etag: null };
  return { value: result.data ?? structuredClone(fallback), etag: result.etag ?? null };
}

/**
 * Read, transform, write — retrying if someone else got there first.
 * `mutate` receives the current value and returns the new one, or throws an
 * Error carrying `.status` to reject the request.
 */
async function update(key, fallback, mutate) {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { value, etag } = await read(key, fallback);
    const next = mutate(structuredClone(value));

    const options = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const { modified } = await store().setJSON(key, next, options);
    if (modified) return next;
    // Someone else wrote in between. Read again and reapply.
  }
  const error = new Error('Too many people editing at once. Try again.');
  error.status = 409;
  throw error;
}

function requireWeek(week) {
  if (!WEEK_RE.test(String(week || ''))) {
    const error = new Error('A week is needed, as YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
  return week;
}

/** The fields a client is allowed to set, run through the shared validator. */
function cleanItem(input) {
  const { ok, value, errors } = validateItem(input);
  if (!ok) {
    const error = new Error(errors[0].message);
    error.status = 400;
    throw error;
  }
  return value;
}

/* ------------------------------------------------------------------ actions */

async function getBoard(url) {
  const week = requireWeek(url.searchParams.get('week'));
  const [weekBlob, annualBlob] = await Promise.all([
    read(weekKey(week), EMPTY_WEEK),
    read(ANNUAL_KEY, { items: [] }),
  ]);

  return json({
    week,
    items: weekBlob.value.items ?? [],
    ticks: weekBlob.value.ticks ?? {},
    annual: annualBlob.value.items ?? [],
  });
}

async function addItem(body) {
  const value = cleanItem(body.item);
  const id = newId();
  const now = new Date().toISOString();
  const record = { ...value, id, createdAt: now, updatedAt: now };

  if (value.annual) {
    await update(ANNUAL_KEY, { items: [] }, (current) => ({
      items: [...(current.items ?? []), record],
    }));
    return json({ id, item: record }, 201);
  }

  const week = requireWeek(body.week);
  await update(weekKey(week), EMPTY_WEEK, (current) => {
    const items = current.items ?? [];
    if (items.length >= MAX_ITEMS_PER_WEEK) {
      const error = new Error('That week is full.');
      error.status = 409;
      throw error;
    }
    return { ...current, items: [...items, record] };
  });
  return json({ id, item: record }, 201);
}

async function patchItem(body) {
  const id = String(body.id || '');
  if (!id) {
    const error = new Error('Which item?');
    error.status = 400;
    throw error;
  }

  const key = body.annual ? ANNUAL_KEY : weekKey(requireWeek(body.week));
  const fallback = body.annual ? { items: [] } : EMPTY_WEEK;

  let found = null;
  await update(key, fallback, (current) => {
    const items = current.items ?? [];
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) {
      const error = new Error('That item is no longer there.');
      error.status = 404;
      throw error;
    }
    // A patch may be a full edit or just { done: true }.
    const merged = { ...items[index], ...body.patch };
    found = { ...cleanItem(merged), id, createdAt: items[index].createdAt, updatedAt: new Date().toISOString() };
    const next = [...items];
    next[index] = found;
    return { ...current, items: next };
  });

  return json({ item: found });
}

async function deleteItem(body) {
  const id = String(body.id || '');
  const key = body.annual ? ANNUAL_KEY : weekKey(requireWeek(body.week));
  const fallback = body.annual ? { items: [] } : EMPTY_WEEK;

  await update(key, fallback, (current) => ({
    ...current,
    items: (current.items ?? []).filter((i) => i.id !== id),
  }));
  return json({ ok: true });
}

/**
 * Tick a calendar event off without touching the calendar.
 * Stored against the week, so it ages out with it.
 */
async function setTick(body) {
  const week = requireWeek(body.week);
  const key = String(body.key || '');
  if (!key) {
    const error = new Error('Which event?');
    error.status = 400;
    throw error;
  }

  await update(weekKey(week), EMPTY_WEEK, (current) => {
    const ticks = { ...(current.ticks ?? {}) };
    if (body.done) ticks[key] = true;
    else delete ticks[key];
    return { ...current, ticks };
  });
  return json({ ok: true });
}

const ACTIONS = {
  add: addItem,
  patch: patchItem,
  delete: deleteItem,
  tick: setTick,
};

export default async (request) => {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') return await getBoard(url);

    if (request.method !== 'POST') {
      return json({ error: 'Use GET to read the week, POST to change it.' }, 405);
    }

    const body = await request.json().catch(() => ({}));
    const action = ACTIONS[body.op];
    if (!action) return json({ error: `Unknown operation: ${body.op}` }, 400);

    return await action(body);
  } catch (error) {
    const status = error.status || 500;
    // A 500 is ours; anything else is the caller's and safe to explain.
    return json({ error: status === 500 ? 'Something went wrong saving that.' : error.message }, status);
  }
};

export const config = { path: '/api/board' };
