-- Phase 2 prerequisite: accounts and sessions.
-- Phase 1 ran on localhost with no login. Phase 2 puts the app on a home
-- network and stores financial records, so every request now needs an identity.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,          -- scrypt, hex
  password_salt TEXT    NOT NULL,          -- hex
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Only the SHA-256 of the session token is stored; the token itself lives in
-- the client cookie and nowhere else, so a stolen database yields no sessions.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL,
  user_agent TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
