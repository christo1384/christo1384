// The board's HTTP API, independent of where it is hosted.
//
// The browser talks to /api/board, /api/calendars and /api/calendar. Anything
// that can hand this module a Request and return its Response can host the
// board — server.mjs does it for Render, and it would sit behind a Netlify
// function just as easily.

import { occurrencesInRange } from '../public/js/ics.js';
import { validateItem } from '../public/js/item.js';

const EMPTY_WEEK = { items: [], ticks: {} };
const ANNUAL_KEY = 'annual';
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS_PER_WEEK = 200;
const MAX_FEED_BYTES = 2 * 1024 * 1024;

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireWeek(week) {
  if (!WEEK_RE.test(String(week || ''))) throw fail('A week is needed, as YYYY-MM-DD.', 400);
  return week;
}

function cleanItem(input) {
  const { ok, value, errors } = validateItem(input);
  if (!ok) throw fail(errors[0].message, 400);
  return value;
}

function newId() {
  return `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parse the calendar feeds out of the environment.
 * The URLs are secrets — a Google "secret address in iCal format" grants read
 * access to that calendar — so they stay on the server and are never sent to
 * the browser. The browser asks for a feed by index instead.
 */
export function parseFeeds(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];

  let entries;
  if (text.startsWith('[')) {
    try {
      entries = JSON.parse(text);
    } catch {
      entries = text.split(/[\n,]/);
    }
  } else {
    entries = text.split(/[\n,]/);
  }

  return (Array.isArray(entries) ? entries : [])
    .map((entry) => (typeof entry === 'string' ? { url: entry } : entry))
    .filter((entry) => entry && typeof entry.url === 'string' && entry.url.trim().startsWith('https://'))
    .map((entry, index) => ({
      id: index,
      url: entry.url.trim(),
      category: entry.category || '',
      label: entry.label || '',
    }));
}

/* ------------------------------------------------------------------- board */

async function getBoard(store, url) {
  const week = requireWeek(url.searchParams.get('week'));
  const [weekBlob, annualBlob] = await Promise.all([
    store.get(`week/${week}`),
    store.get(ANNUAL_KEY),
  ]);

  return json({
    week,
    items: weekBlob?.items ?? [],
    ticks: weekBlob?.ticks ?? {},
    annual: annualBlob?.items ?? [],
  });
}

async function addItem(store, body) {
  const value = cleanItem(body.item);
  const now = new Date().toISOString();
  const record = { ...value, id: newId(), createdAt: now, updatedAt: now };

  if (value.annual) {
    await store.mutate(ANNUAL_KEY, { items: [] }, (current) => ({
      items: [...(current.items ?? []), record],
    }));
  } else {
    const week = requireWeek(body.week);
    await store.mutate(`week/${week}`, EMPTY_WEEK, (current) => {
      const items = current.items ?? [];
      if (items.length >= MAX_ITEMS_PER_WEEK) throw fail('That week is full.', 409);
      return { ...current, items: [...items, record] };
    });
  }
  return json({ id: record.id, item: record }, 201);
}

async function patchItem(store, body) {
  const id = String(body.id || '');
  if (!id) throw fail('Which item?', 400);

  const key = body.annual ? ANNUAL_KEY : `week/${requireWeek(body.week)}`;
  const fallback = body.annual ? { items: [] } : EMPTY_WEEK;

  let updated = null;
  await store.mutate(key, fallback, (current) => {
    const items = current.items ?? [];
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) throw fail('That item is no longer there.', 404);

    const merged = { ...items[index], ...body.patch };
    updated = {
      ...cleanItem(merged),
      id,
      createdAt: items[index].createdAt,
      updatedAt: new Date().toISOString(),
    };
    const next = [...items];
    next[index] = updated;
    return { ...current, items: next };
  });
  return json({ item: updated });
}

async function deleteItem(store, body) {
  const id = String(body.id || '');
  const key = body.annual ? ANNUAL_KEY : `week/${requireWeek(body.week)}`;
  const fallback = body.annual ? { items: [] } : EMPTY_WEEK;

  await store.mutate(key, fallback, (current) => ({
    ...current,
    items: (current.items ?? []).filter((i) => i.id !== id),
  }));
  return json({ ok: true });
}

/** Tick a calendar entry off without ever writing to the calendar. */
async function setTick(store, body) {
  const week = requireWeek(body.week);
  const key = String(body.key || '');
  if (!key) throw fail('Which event?', 400);

  await store.mutate(`week/${week}`, EMPTY_WEEK, (current) => {
    const ticks = { ...(current.ticks ?? {}) };
    if (body.done) ticks[key] = true;
    else delete ticks[key];
    return { ...current, ticks };
  });
  return json({ ok: true });
}

const ACTIONS = { add: addItem, patch: patchItem, delete: deleteItem, tick: setTick };

/* ---------------------------------------------------------------- calendar */

/** What the browser is told about the feeds: everything except the address. */
export function describeFeeds(feeds) {
  return feeds.map(({ id, category, label }) => ({ id, category, label }));
}

export async function fetchFeed(feeds, url, { fetchImpl = globalThis.fetch } = {}) {
  const id = Number(url.searchParams.get('feed'));
  const feed = feeds.find((f) => f.id === id);
  if (!feed) throw fail('No such calendar.', 404);

  const upstream = await fetchImpl(feed.url, {
    redirect: 'follow',
    headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!upstream.ok) throw fail(`Calendar feed returned ${upstream.status}.`, 502);

  const text = await upstream.text();
  if (text.length > MAX_FEED_BYTES) throw fail('Calendar feed is too large.', 502);

  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, max-age=300',
    },
  });
}

/* ----------------------------------------------------------------- routing */

/**
 * Handle one API request.
 * Returns null when the path is not an API path, so the caller can fall
 * through to serving files.
 */
export async function handleApi(request, { store, feeds }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;

  try {
    if (url.pathname === '/api/calendars' && request.method === 'GET') {
      return json({ calendars: describeFeeds(feeds) });
    }

    if (url.pathname === '/api/calendar' && request.method === 'GET') {
      return await fetchFeed(feeds, url);
    }

    if (url.pathname === '/api/board') {
      if (request.method === 'GET') return await getBoard(store, url);
      if (request.method !== 'POST') throw fail('Use GET to read the week, POST to change it.', 405);

      const body = await request.json().catch(() => ({}));
      const action = ACTIONS[body.op];
      if (!action) throw fail(`Unknown operation: ${body.op}`, 400);
      return await action(store, body);
    }

    return json({ error: 'No such endpoint.' }, 404);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('[api]', error);
    return json({ error: status === 500 ? 'Something went wrong.' : error.message }, status);
  }
}

export { occurrencesInRange };
