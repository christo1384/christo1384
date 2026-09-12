-- Phase 3: the operations that were living in his head or in text messages.
-- Leads in, estimates out, invoices paid. Money stays whole cents.

CREATE TABLE leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  phone            TEXT,
  email            TEXT,
  source           TEXT,
  description      TEXT,
  received_on      TEXT    NOT NULL DEFAULT (date('now')),
  status           TEXT    NOT NULL DEFAULT 'new',
  lost_reason      TEXT,
  converted_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_leads_status ON leads(status, received_on);

-- A sent estimate is never edited. Changing one creates the next version, so
-- there is always a record of exactly what the customer was shown.
CREATE TABLE estimates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL DEFAULT 1,
  status         TEXT    NOT NULL DEFAULT 'draft',
  markup_percent REAL    NOT NULL DEFAULT 0,
  valid_until    TEXT,
  sent_at        TEXT,
  decided_at     TEXT,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, version)
);

CREATE INDEX idx_estimates_job ON estimates(job_id, version DESC);

CREATE TABLE estimate_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id     INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  description     TEXT    NOT NULL,
  quantity        REAL    NOT NULL DEFAULT 1,
  unit            TEXT,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  category        TEXT
);

CREATE INDEX idx_estimate_lines_estimate ON estimate_lines(estimate_id, sort_order);

-- ON DELETE RESTRICT: a job that has been invoiced cannot be deleted out from
-- under its billing history.
CREATE TABLE invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  invoice_number TEXT    UNIQUE NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'draft',
  issued_on      TEXT,
  due_on         TEXT,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invoices_job ON invoices(job_id);
CREATE INDEX idx_invoices_status ON invoices(status, due_on);

CREATE TABLE invoice_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  description      TEXT    NOT NULL,
  quantity         REAL    NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id, sort_order);

CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  received_on  TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL,
  method       TEXT,
  reference    TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_payments_invoice ON payments(invoice_id, received_on);
