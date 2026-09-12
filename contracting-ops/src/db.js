import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, 'migrations');

/**
 * Opens the database and brings it up to the latest schema.
 * Migrations are plain .sql files applied in filename order, once each.
 */
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });

  const db = new DatabaseSync(file);

  // SQLite creates the file with the process umask, which is usually 0644 -
  // readable by every local account. This database holds the books, client
  // contact details and password hashes, and the box may be shared with other
  // services, so narrow it before anything is written. Locking it down before
  // enabling WAL matters: SQLite copies the database file's mode onto the
  // -wal and -shm files when it creates them.
  if (file !== ':memory:') restrictPermissions(file);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Owner-only on the database, its sidecar files, and the directory holding them. */
function restrictPermissions(file) {
  try {
    chmodSync(dirname(file), 0o700);
    for (const path of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  } catch (err) {
    // A database on a filesystem without Unix permissions is not a reason to
    // refuse to start; say so loudly instead.
    console.warn(`Could not restrict permissions on ${file}: ${err.message}`);
  }
}

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${err.message}`);
    }
  }
}

/** Wraps fn in a transaction; node:sqlite has no helper of its own. */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
