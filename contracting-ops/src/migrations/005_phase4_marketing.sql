-- Phase 4: where the work comes from, and what it cost to get it.
-- Attribution hangs off the phase 3 leads table and the phase 2 expenses table
-- rather than duplicating either.

CREATE TABLE campaigns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  channel    TEXT    NOT NULL,
  started_on TEXT    NOT NULL DEFAULT (date('now')),
  ended_on   TEXT,
  notes      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE leads ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;

-- Who sent this work. The single most valuable field in the system for a
-- contractor booked by word of mouth.
ALTER TABLE leads ADD COLUMN referred_by_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE expenses ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX idx_leads_campaign ON leads(campaign_id);
CREATE INDEX idx_leads_referrer ON leads(referred_by_client_id);
CREATE INDEX idx_expenses_campaign ON expenses(campaign_id);

-- One per job: asking the same customer twice for the same job is worse than
-- not asking at all.
CREATE TABLE review_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  channel      TEXT,
  requested_on TEXT,
  responded_on TEXT,
  rating       INTEGER,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_review_requests_status ON review_requests(status, created_at);
