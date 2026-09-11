# Roadmap

Phase 1 is built. This document specifies phases 2–4 in enough detail to build
them in order: the tables, the endpoints, the screens, and what "done" means.

The sequencing rule is that **each phase has to be independently useful**. Phase
2 is worth running even if phase 3 never gets built. That is what makes it safe
to stop — and phase 4 is being stopped on deliberately, because the business is
booked out for months and marketing would be solving a problem it does not have.

---

## Conventions that carry across phases

- **Migrations** are numbered SQL files in `src/migrations/`, applied once each
  in filename order. Never edit a migration that has shipped; add another.
- **Money is stored in whole cents as INTEGER.** Never floats. A column holding
  dollars is named `*_cents` so nobody has to guess.
- **State changes get a timeline entry** in the same transaction as the change,
  the way `POST /api/jobs/:id/status` already does.
- **Routes** get a module in `src/routes/` and a `register*Routes(router, db)`
  export, wired up in `src/server.js`.
- **Every phase ships tests** in `test/` before it is called done.

---

## Phase 2 — Financials

Where the money went, per job. This is what turns a job tracker into something
that answers "did we make anything on that kitchen?"

### Prerequisites (do these first)

Phase 2 stores financial records and uploaded files. Before it goes live:

1. **Authentication** — a login with a hashed password and a session cookie.
   `node:crypto`'s `scrypt` is sufficient; no dependency needed.
2. **Automated backup** of `data/ops.db` and the uploads directory.
3. **Upload validation** — cap file size, allow only `image/*` and
   `application/pdf`, store outside the web root under a generated filename,
   never the client-supplied one.

### Schema — `002_phase2_financials.sql`

```sql
CREATE TABLE vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,              -- lumber, plumbing, rental, ...
  account_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,  -- NULL = overhead
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  spent_on TEXT NOT NULL,                 -- YYYY-MM-DD
  amount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL,                 -- materials|labor|subcontractor|permit|rental|fuel|other
  payment_method TEXT,                    -- card|check|cash|ach
  description TEXT,
  billable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE attachments (                -- receipt images now, job photos in phase 3
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL,               -- 'expense' | 'job'
  owner_id INTEGER NOT NULL,
  stored_name TEXT NOT NULL,              -- generated; never the uploaded name
  original_name TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE job_budgets (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  contract_cents INTEGER,                 -- what the client is paying
  materials_budget_cents INTEGER,
  labor_budget_cents INTEGER,
  other_budget_cents INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_expenses_job ON expenses(job_id, spent_on);
CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id);
```

### Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` `POST` | `/api/expenses` | List (filter by `job_id`, `category`, date range) and create |
| `PATCH` `DELETE` | `/api/expenses/:id` | Edit or remove an expense |
| `POST` | `/api/expenses/:id/receipt` | Upload a receipt image/PDF |
| `GET` | `/api/attachments/:id` | Stream a stored file |
| `GET` `POST` | `/api/vendors` | Vendor list and creation |
| `GET` `PUT` | `/api/jobs/:id/budget` | Read/set the budget for a job |
| `GET` | `/api/jobs/:id/costs` | Spend by category, budget vs. actual, margin |
| `GET` | `/api/reports/spend` | Spend by month, by category, by vendor |

### Screens

- **Job detail** gains a *Money* panel: contract, spent, remaining, margin, and
  the expense list for that job.
- **Expenses** — a full list with filters, and a quick-add form built for a
  phone (date defaults to today, camera capture for the receipt).
- **Reports** — spend by month and by category, with a job breakdown.

### Done when

- An expense can be added from a phone in under 20 seconds, receipt attached.
- A job shows budget vs. actual per category and a margin figure.
- Uncategorised overhead (`job_id IS NULL`) is reportable separately.
- Deleting a job does not delete its expenses' financial history — they detach.
- Money arithmetic is tested in cents with no floating point anywhere.

---

## Phase 3 — Executive and operations

The functions that were living in his head or in text messages.

### Schema — `003_phase3_operations.sql`

```sql
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT, email TEXT,
  source TEXT,                            -- referral|repeat|web|sign|other
  description TEXT,
  received_on TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL DEFAULT 'new',     -- new|contacted|qualified|converted|lost
  lost_reason TEXT,
  converted_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft|sent|accepted|declined|expired
  markup_percent REAL NOT NULL DEFAULT 0,
  valid_until TEXT,
  sent_at TEXT, decided_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, version)
);

CREATE TABLE estimate_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,                              -- ea|lf|sf|hr|day|ls
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  category TEXT
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  invoice_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft|sent|partial|paid|void
  issued_on TEXT, due_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  received_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT,                            -- check|ach|card|cash
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Job photos reuse the phase 2 `attachments` table with `owner_type = 'job'`.

### Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` `POST` | `/api/leads` | Intake list and capture |
| `POST` | `/api/leads/:id/convert` | Turn a lead into a client + job in one transaction |
| `GET` `POST` | `/api/jobs/:id/estimates` | Estimate versions for a job |
| `PATCH` | `/api/estimates/:id` | Edit lines, markup, status |
| `POST` | `/api/estimates/:id/send` | Mark sent, stamp `sent_at` |
| `POST` | `/api/estimates/:id/accept` | Accept → move the job to `scheduled` |
| `GET` `POST` | `/api/jobs/:id/invoices` | Invoices for a job |
| `POST` | `/api/invoices/:id/payments` | Record a payment; recompute status |
| `GET` | `/api/invoices?status=overdue` | Receivables |
| `GET` `POST` | `/api/jobs/:id/photos` | Job photo gallery |
| `GET` | `/api/reports/executive` | Win rate, backlog value, receivables, margin by job |

### Screens

- **Leads inbox** — capture in under 15 seconds, one button to convert.
- **Estimate builder** — line items with live totals and markup; new versions
  instead of edits to a sent estimate.
- **Invoices** — build from accepted estimate lines or from actuals; record
  payments; an overdue list.
- **Job photos** — a per-job gallery with before/progress/after captions.
- **Executive dashboard** — win rate by lead source, backlog value, cash owed,
  margin by completed job.

### Done when

- A lead can be captured, quoted, won, invoiced and paid without leaving the app.
- Estimate versions are immutable once sent; changes create version 2.
- An invoice's status is derived from its payments, never set by hand.
- Money still never touches a float.

---

## Phase 4 — Marketing (deferred)

**Deliberately not being built.** The business is booked solid for months, so
demand generation is not the constraint — scheduling capacity is. Building it
now would mean maintaining a feature nobody opens.

The trigger to revisit: the pipeline (leads + estimating + bids out) drops below
roughly four weeks of work for two consecutive weeks. Phase 1's dashboard makes
that visible without any extra tooling.

When that happens, the sketch is:

- `campaigns` and a `lead_sources` lookup, with lead attribution on conversion —
  phase 3 already records `leads.source`, so the history will be there.
- Review requests: a nudge when a job hits `complete`, with a sent/received log.
- Referral tracking: which past clients send work, and how much it was worth.
- Cost per acquired job, using phase 2's overhead expenses.

The single most valuable piece is referral tracking, because for a contractor
booked by word of mouth, that is where the work actually comes from. Build that
first and stop if it is enough.
