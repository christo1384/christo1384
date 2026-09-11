import { sendJson, readJson, HttpError } from '../lib/http.js';
import {
  createUser, startSession, endSession, verifyPassword, publicUser, userCount,
  checkThrottle, recordFailure, clearFailures, readCookie, sessionCookie,
} from '../lib/auth.js';

export function registerAuthRoutes(router, db, { secureCookies }) {
  // Tells the login screen whether this is a brand-new install.
  router.get('/api/auth/status', (req, res) => {
    sendJson(res, 200, { needs_setup: userCount(db) === 0 });
  });

  router.get('/api/auth/me', (req, res, { user }) => {
    if (!user) throw new HttpError(401, 'Not signed in');
    sendJson(res, 200, user);
  });

  // First-run only: creates the first account so the system can be set up from
  // a phone. Closes permanently the moment one user exists.
  router.post('/api/auth/setup', async (req, res) => {
    if (userCount(db) > 0) throw new HttpError(409, 'This system already has an account. Sign in instead.');
    const body = await readJson(req);
    const user = createUser(db, {
      username: body.username, displayName: body.display_name, password: body.password,
    });
    issue(db, res, user, req, secureCookies);
  });

  router.post('/api/auth/login', async (req, res) => {
    const body = await readJson(req);
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    const throttleKey = `${username.toLowerCase()}|${req.socket.remoteAddress}`;

    checkThrottle(throttleKey);
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
      recordFailure(throttleKey);
      throw new HttpError(401, 'Wrong username or password');
    }

    clearFailures(throttleKey);
    issue(db, res, publicUser(row), req, secureCookies);
  });

  router.post('/api/auth/logout', (req, res) => {
    endSession(db, readCookie(req, 'session'));
    res.setHeader('set-cookie', sessionCookie('', 0, secureCookies));
    sendJson(res, 200, { ok: true });
  });

  // Adding further accounts requires being signed in already.
  router.post('/api/users', async (req, res, { user }) => {
    if (!user) throw new HttpError(401, 'Not signed in');
    const body = await readJson(req);
    sendJson(res, 201, createUser(db, {
      username: body.username, displayName: body.display_name, password: body.password,
    }));
  });

  router.get('/api/users', (req, res, { user }) => {
    if (!user) throw new HttpError(401, 'Not signed in');
    sendJson(res, 200, db.prepare(
      'SELECT id, username, display_name, last_login_at FROM users ORDER BY username',
    ).all());
  });
}

function issue(db, res, user, req, secureCookies) {
  const { token, maxAge } = startSession(db, user.id, req.headers['user-agent']);
  res.setHeader('set-cookie', sessionCookie(token, maxAge, secureCookies));
  sendJson(res, 200, user);
}
