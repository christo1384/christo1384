import { randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

const failures = new Map(); // key -> { count, until }

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, storedHash, salt) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createUser(db, { username, displayName, password }) {
  if (!/^[a-z0-9_.-]{2,40}$/i.test(username ?? '')) {
    throw new HttpError(400, 'Username must be 2-40 characters: letters, numbers, dot, dash, underscore');
  }
  if (typeof password !== 'string' || password.length < 10) {
    throw new HttpError(400, 'Password must be at least 10 characters');
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new HttpError(409, 'That username is already taken');
  }

  const { hash, salt } = hashPassword(password);
  const info = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)',
  ).run(username, (displayName || username).trim(), hash, salt);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid)));
}

export function startSession(db, userId, userAgent) {
  const token = randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
     VALUES (?, ?, datetime('now', ?), ?)`,
  ).run(hashToken(token), userId, `+${SESSION_DAYS} days`, (userAgent ?? '').slice(0, 200));
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function endSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function userForToken(db, token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
  ).get(hashToken(token));
  return row ? publicUser(row) : null;
}

export const publicUser = (row) => ({
  id: row.id, username: row.username, display_name: row.display_name, last_login_at: row.last_login_at,
});

export const userCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

/** Throttles password guessing per username+address. */
export function checkThrottle(key) {
  const entry = failures.get(key);
  if (entry && entry.until > Date.now()) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute(s).`);
  }
}

export function recordFailure(key) {
  const entry = failures.get(key) ?? { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.until = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failures.set(key, entry);
}

export const clearFailures = (key) => failures.delete(key);

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token, maxAge, secure) {
  const parts = [
    `session=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
