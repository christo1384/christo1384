// Where the board's own data lives.
//
// Most of what the board shows comes from the family calendar and is fetched
// fresh every time, so what is kept here is only the residue: notes, dinner,
// birthdays, and which calendar entries have been ticked off.
//
// Two layers, because Render's free Key Value plan runs with persistence off:
// Key Value is the shared source of truth across restarts of the web service,
// and a local snapshot file survives a restart of Key Value. Either one can
// come back empty without the week being lost.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_SNAPSHOT_PATH = process.env.SNAPSHOT_PATH || '/tmp/mrcl-family-snapshot.json';

/** An in-memory store, used for local development and as the read cache. */
function createMemoryLayer() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async all() {
      return Object.fromEntries([...data.entries()].map(([k, v]) => [k, structuredClone(v)]));
    },
    async load(entries) {
      for (const [k, v] of Object.entries(entries || {})) data.set(k, v);
    },
  };
}

async function readSnapshot(path) {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeSnapshot(path, entries) {
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(entries), 'utf8');
  } catch {
    // A snapshot is a convenience, never a requirement.
  }
}

/**
 * @param {string} [redisUrl] Render's Key Value connection string. Without
 *   one the store is purely in-memory, which is what local development wants.
 * @param {object} [options]
 * @param {string|null} [options.snapshotPath] Where the local snapshot lives.
 *   Pass null to turn snapshotting off — tests want isolated stores, and a
 *   shared file on disk would leak one test's data into the next.
 */
export async function createStore(redisUrl, { snapshotPath = DEFAULT_SNAPSHOT_PATH } = {}) {
  const memory = createMemoryLayer();
  let redis = null;

  if (redisUrl) {
    const { createClient } = await import('redis');
    redis = createClient({ url: redisUrl });
    // Without a handler, a dropped connection would take the process down.
    redis.on('error', (error) => console.error('[store] key value error:', error.message));
    await redis.connect();
  }

  const snapshot = await readSnapshot(snapshotPath);

  async function get(key) {
    if (redis) {
      const raw = await redis.get(key);
      if (raw !== null) {
        const value = JSON.parse(raw);
        await memory.set(key, value);
        return value;
      }
      // Key Value has restarted and lost everything: fall back to whatever the
      // snapshot and this process still know, and put it back.
      const local = (await memory.get(key)) ?? snapshot?.[key] ?? null;
      if (local) await redis.set(key, JSON.stringify(local));
      return local;
    }
    return (await memory.get(key)) ?? snapshot?.[key] ?? null;
  }

  async function set(key, value) {
    await memory.set(key, value);
    if (redis) await redis.set(key, JSON.stringify(value));
    await writeSnapshot(snapshotPath, await memory.all());
  }

  /** Read, change, write — with the read and the write as close together as possible. */
  async function mutate(key, fallback, change) {
    const current = (await get(key)) ?? structuredClone(fallback);
    const next = change(structuredClone(current));
    await set(key, next);
    return next;
  }

  if (snapshot) await memory.load(snapshot);

  return {
    get,
    set,
    mutate,
    async close() {
      if (redis) await redis.quit().catch(() => {});
    },
    get backend() {
      return redis ? 'key-value' : 'memory';
    },
  };
}
