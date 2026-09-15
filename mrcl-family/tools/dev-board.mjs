// An in-memory stand-in for netlify/functions/board.mjs, so `npm run dev` and
// the browser suite work without Netlify Blobs. Same request and response
// shapes; the data simply does not survive a restart.

import { validateItem } from '../public/js/item.js';

const weeks = new Map(); // week -> { items, ticks }
const annual = { items: [] };
let counter = 0;

const weekOf = (week) => {
  if (!weeks.has(week)) weeks.set(week, { items: [], ticks: {} });
  return weeks.get(week);
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function clean(input) {
  const { ok, value, errors } = validateItem(input);
  if (!ok) throw Object.assign(new Error(errors[0].message), { status: 400 });
  return value;
}

/** Wipe everything — used between browser-suite cases. */
export function reset() {
  weeks.clear();
  annual.items = [];
  counter = 0;
}

/** Seed the store directly, bypassing the API. */
export function seed({ week, items = [], ticks = {}, annualItems = [] } = {}) {
  reset();
  if (week) weeks.set(week, { items: structuredClone(items), ticks: structuredClone(ticks) });
  annual.items = structuredClone(annualItems);
}

export default async function devBoard(request) {
  try {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const week = url.searchParams.get('week');
      const blob = weekOf(week);
      return json({ week, items: blob.items, ticks: blob.ticks, annual: annual.items });
    }

    const body = await request.json().catch(() => ({}));

    if (body.op === 'add') {
      const value = clean(body.item);
      counter += 1;
      const now = new Date().toISOString();
      const record = { ...value, id: `dev_${counter}`, createdAt: now, updatedAt: now };
      if (value.annual) annual.items.push(record);
      else weekOf(body.week).items.push(record);
      return json({ id: record.id, item: record }, 201);
    }

    if (body.op === 'patch') {
      const bucket = body.annual ? annual.items : weekOf(body.week).items;
      const index = bucket.findIndex((i) => i.id === body.id);
      if (index === -1) throw Object.assign(new Error('That item is no longer there.'), { status: 404 });
      const merged = { ...bucket[index], ...body.patch };
      bucket[index] = { ...clean(merged), id: body.id, updatedAt: new Date().toISOString() };
      return json({ item: bucket[index] });
    }

    if (body.op === 'delete') {
      const blob = body.annual ? annual : weekOf(body.week);
      blob.items = blob.items.filter((i) => i.id !== body.id);
      if (!body.annual) weeks.set(body.week, blob);
      return json({ ok: true });
    }

    if (body.op === 'tick') {
      const blob = weekOf(body.week);
      if (body.done) blob.ticks[body.key] = true;
      else delete blob.ticks[body.key];
      return json({ ok: true });
    }

    return json({ error: `Unknown operation: ${body.op}` }, 400);
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
}
