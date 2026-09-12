-- Phase 1: job and status tracking.
-- Entities: clients, jobs, and a unified job_events timeline (status changes + notes).

CREATE TABLE clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  company       TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_number      TEXT    UNIQUE,
  client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  title           TEXT    NOT NULL,
  description     TEXT,
  site_address    TEXT,
  status          TEXT    NOT NULL DEFAULT 'lead',
  priority        TEXT    NOT NULL DEFAULT 'normal',
  start_date      TEXT,
  target_end_date TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_client ON jobs(client_id);
CREATE INDEX idx_jobs_start_date ON jobs(start_date);

-- One timeline per job. kind = 'created' | 'status_change' | 'note'
CREATE TABLE job_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  body        TEXT,
  author      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_job_events_job ON job_events(job_id, created_at DESC);
