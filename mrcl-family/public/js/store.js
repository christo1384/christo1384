// Talking to the board's own store.
//
// Firebase is gone: no second console, no auth provider, no rules file, no SDK
// off a CDN. The board's residual data lives in Netlify Blobs behind
// /api/board on this same domain.
//
// Realtime push is traded for polling. On a kitchen wall that is invisible —
// and the version this replaces polled every five minutes.

import { toISODate } from './week.js';

const ENDPOINT = '/api/board';
const POLL_MS = 15_000;

async function call(options = {}) {
  const { method = 'GET', body, query, fetchImpl = globalThis.fetch } = options;

  const url = new URL(ENDPOINT, globalThis.location?.origin || 'http://localhost');
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);

  const response = await fetchImpl(url.pathname + url.search, {
    method,
    cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `The board said ${response.status}.`);
  return payload;
}

/** The Monday (or Sunday) a week is filed under. */
export function weekKeyFor(days) {
  return days[0].iso;
}

/** One read of a week: its own items, its ticks, and the annual entries. */
export function fetchWeek(days, options = {}) {
  return call({ query: { week: weekKeyFor(days) }, ...options });
}

/**
 * Poll a week until the returned function is called.
 * `onChange` gets { items, ticks, repeating, shopping } and only fires when
 * something actually changed, so the board does not re-render every 15 seconds
 * for nothing.
 */
export function subscribeToWeek(days, onChange, onError = () => {}, { intervalMs = POLL_MS } = {}) {
  let stopped = false;
  let timer = null;
  let lastSeen = '';

  const tick = async () => {
    if (stopped) return;
    try {
      const payload = await fetchWeek(days);
      if (stopped) return;

      const fingerprint = JSON.stringify([payload.items, payload.ticks, payload.repeating, payload.shopping]);
      if (fingerprint !== lastSeen) {
        lastSeen = fingerprint;
        onChange({
          items: payload.items || [],
          ticks: payload.ticks || {},
          repeating: payload.repeating || [],
          shopping: payload.shopping || [],
        });
      }
      onError('');
    } catch (error) {
      if (!stopped) onError(error.message || 'read-failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function addItem(input, days) {
  const payload = await call({
    method: 'POST',
    body: { op: 'add', week: weekKeyFor(days), item: input },
  });
  return payload.id;
}

export async function updateItem(id, patch, { days, repeating = false } = {}) {
  await call({
    method: 'POST',
    body: { op: 'patch', id, patch, repeating, week: days ? weekKeyFor(days) : undefined },
  });
}

export async function deleteItem(id, { days, repeating = false } = {}) {
  await call({
    method: 'POST',
    body: { op: 'delete', id, repeating, week: days ? weekKeyFor(days) : undefined },
  });
}

/** Tick off an item the board owns. */
export function setDone(id, done, context) {
  return updateItem(id, { done: Boolean(done) }, context);
}

/**
 * Tick off a calendar event. The calendar is never written to — only the fact
 * that somebody handled it, stored against the week.
 */
export async function setTick(key, done, days) {
  await call({ method: 'POST', body: { op: 'tick', week: weekKeyFor(days), key, done: Boolean(done) } });
}

/* ------------------------------------------------------------ shopping list */

export async function addShoppingItem(title, who = '') {
  const payload = await call({ method: 'POST', body: { op: 'shopping-add', item: { title, who } } });
  return payload.id;
}

export function setShoppingDone(id, done) {
  return call({ method: 'POST', body: { op: 'shopping-toggle', id, done: Boolean(done) } });
}

export function deleteShoppingItem(id) {
  return call({ method: 'POST', body: { op: 'shopping-delete', id } });
}

/** Clear what is in the trolley, keep what is still needed. */
export function clearBoughtShopping() {
  return call({ method: 'POST', body: { op: 'shopping-clear-bought' } });
}

/** A stable per-occurrence key for a calendar event. */
export function tickKey(item) {
  return `${item.uid || item.title}|${item.date}`;
}

export { toISODate };
