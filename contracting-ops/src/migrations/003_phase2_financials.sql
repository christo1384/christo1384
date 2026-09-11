-- Phase 2: where the money went, per job.
-- All money is whole cents in INTEGER columns. Never floats, never dollars.

CREATE TABLE vendors (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  category       TEXT,
  account_number TEXT,
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER REFERENCES jobs(id) ON DELETE SET NULL,   -- NULL = overhead
  vendor_id      INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  spent_on       TEXT    NOT NULL,
  amount_cents   INTEGER NOT NULL,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  category       TEXT    NOT NULL,
  payment_method TEXT,
  description    TEXT,
  billable       INTEGER NOT NULL DEFAULT 1,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_expenses_job ON expenses(job_id, spent_on);
CREATE INDEX idx_expenses_spent_on ON expenses(spent_on);
CREATE INDEX idx_expenses_vendor ON expenses(vendor_id);

-- Receipt images now; phase 3 reuses this table for job photos.
CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type    TEXT    NOT NULL,          -- 'expense' | 'job'
  owner_id      INTEGER NOT NULL,
  stored_name   TEXT    NOT NULL UNIQUE,   -- generated; never the uploaded name
  original_name TEXT,
  mime_type     TEXT    NOT NULL,
  byte_size     INTEGER NOT NULL,
  caption       TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id);

CREATE TABLE job_budgets (
  job_id                 INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  contract_cents         INTEGER,
  materials_budget_cents INTEGER,
  labor_budget_cents     INTEGER,
  other_budget_cents     INTEGER,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
