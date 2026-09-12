# Contracting Ops

A backend operations system for a general contracting business — leads, bids,
jobs, receipts, invoicing, all in one place instead of spread across a phone,
a truck console and a shoebox of receipts.

It is built in **phases**, so the business gets something usable immediately
rather than waiting for the whole system:

| Phase | Scope | Status |
| ----- | ----- | ------ |
| **1** | Jobs and their status — clients, the job lifecycle, a timeline per job, a dashboard of what needs attention | **Built and working** |
| **2** | Financials — accounts, receipts, expense tracking, job costing, budget vs. actual, spend reports | **Built and working** |
| **3** | Executive + operations — leads, estimates, invoicing, payments, job photos, business reporting | **Built and working** |
| 4 | Marketing — referral tracking, review requests, campaign attribution | Deferred (booked solid) |

Phase 4 is specified in [`docs/ROADMAP.md`](docs/ROADMAP.md), along with the
written trigger for revisiting it.

It runs on a Linux box at home and is used from a phone on the same wifi.
[`docs/DEPLOY.md`](docs/DEPLOY.md) is the full setup: service, fixed address,
firewall, accounts, iPhone home screen, backups.

---

## Running it

Requires **Node 22.5 or newer**. There are no dependencies to install — the
server uses Node's built-in HTTP and SQLite modules, and the frontend is plain
HTML, CSS and JavaScript with no build step.

```sh
npm run seed     # optional: load demo clients, jobs, vendors and expenses
npm start        # http://localhost:4000
```

The first time you open it, nobody has an account, so it shows a one-time setup
screen. Create the first account there — that screen closes for good afterwards.
Add more people from **Account → Add another person**, or from the terminal with
`npm run user:add -- --username mike --name "Mike"`.

It binds `0.0.0.0` by default so a phone on the same network can reach it;
`HOST=127.0.0.1 npm start` keeps it on the machine only.

| Command | What it does |
| ------- | ------------ |
| `npm start` | Runs the server on port 4000 (`PORT=8080 npm start` to change it) |
| `npm run dev` | Same, restarting on file changes |
| `npm run seed` | Loads demo data; `npm run seed -- --force` replaces what's there |
| `npm run user:add` | Creates an account (`-- --username mike --name "Mike"`) |
| `npm run user:passwd` | Resets a password and signs that person out everywhere |
| `npm run user:list` | Lists accounts and when each last signed in |
| `npm run backup` | Snapshots the database and receipts into `backups/` |
| `npm test` | Runs the API test suite |

Everything lives in `data/` — `ops.db` plus `uploads/` for receipt images.
`DB_FILE=/path/to/other.db npm start` points at a different database. Set up the
nightly backup (`docs/DEPLOY.md`) before it holds anything you would miss.

---

## Phase 1: what it does

**The job lifecycle.** Every job moves through a fixed set of states, and the
system only allows moves that make sense:

```
Lead → Estimating → Bid sent → Scheduled → In progress → Punch list → Complete
                                                                    ↘ Cancelled
```

Trying to jump a job straight from Lead to Complete is rejected with an
explanation of what moves *are* available. The UI only shows the legal buttons.

**A timeline per job.** Every status change and every note is recorded with a
timestamp and who logged it. Nothing is overwritten, so there is always an
answer to "when did we send that bid?"

**A dashboard that tells him what to do today**, rather than just listing data:

- **Needs attention** — open jobs with no activity for 7+ days. Chasing these is
  the single highest-value thing a contractor can do with ten minutes.
- **Starting in the next two weeks** — what's coming, in date order.
- **Past target finish date** — jobs underway that have blown their end date.
- **Recent activity** — the last 15 things that happened across all jobs.

**Clients.** Contact details, and every job for that client in one place.
Deleting a client keeps their jobs (the history is worth more than the tidiness).

It works on a phone — the layout is responsive, so status can be updated from
the truck.

---

## Phase 2: what it does

**Every request needs an account.** Phase 1 ran on localhost with no login;
phase 2 puts the app on a home network and stores financial records, so there is
a sign-in, sessions that last 30 days, and a lockout after eight bad password
attempts. Passwords are scrypt-hashed; only the SHA-256 of a session token is
stored, so a stolen database yields no live sessions.

**Expenses, in whole cents.** Date, amount, category (materials, labor,
subcontractor, permit, rental, fuel, other), vendor, payment method, and whether
it is billable. An expense with no job attached is overhead, and is reported
separately. Money is stored as integer cents everywhere — no float ever touches
a dollar figure.

**Receipts from the phone.** Photograph a receipt in the add-expense form and it
is downscaled in the browser before upload, so a 4 MB iPhone photo arrives as
roughly 300 KB. Uploads are identified by their leading bytes rather than the
declared type, capped at 12 MB, stored under a generated filename with `0600`
permissions, and served only to a signed-in session.

**Job costing.** Set a contract amount and per-line budgets on a job; its Money
panel then shows contract, spent, margin, and a bar per budget line that turns
red when it is over. Labor and subcontractor spend both count against the labor
line, because that is how the money is actually felt.

**Spend reports.** Totals by month, category, vendor and job, with a date range,
and overhead split out from job spend.

**Deleting a job does not delete its expenses.** They detach and become
overhead. Financial history outlives the record it was attached to.

---

## Phase 3: what it does

**A lead inbox.** Capture a phone call in seconds — name, how they found you,
what they want. One button converts a lead into a client and a job in a single
transaction, carrying the description and contact details across and opening the
job's timeline with where it came from.

**Estimates that hold their shape.** Line items with quantity, unit and cost,
plus a markup percentage, with live totals. Marking one as sent freezes it: the
lines, the markup and the terms can no longer be touched, and revising it copies
it into version 2. There is always an exact record of what the customer was
shown. Accepting an estimate closes out the other versions, writes its total in
as the job's contract amount, and moves the job to scheduled.

**Invoices whose status is a fact, not a field.** Build one from the accepted
estimate (billing exactly what was agreed, with the markup as its own line so
the total matches to the cent), from the job's billable expenses grouped by
category, or empty. The status is derived from the payments every time anything
changes — draft, sent, partial, paid — and cannot be set by hand. A payment
larger than the balance is refused; deleting one walks the status back. An
issued invoice is voided, never deleted, and a job with invoices against it
cannot be deleted at all.

**A job photo record.** Every photo is tagged before, progress, after or issue,
shrunk in the browser like receipts, and shown as a gallery on the job. Six
months later it is the difference between remembering and arguing.

**A business report**, answering the four questions worth asking: am I winning
work (win rate by lead source and by bid), how much is on the books (backlog and
expected margin), who owes me (receivables aged into buckets), and did the
finished jobs make money.

---

## API

All responses are JSON. Errors return `{ "error": "...", "details": { ... } }`.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/dashboard` | Totals, stale jobs, upcoming starts, overdue, recent activity |
| `GET` | `/api/meta` | Status list, allowed transitions, priorities |
| `GET` | `/api/jobs` | List jobs; filters: `status`, `group`, `client_id`, `search` |
| `POST` | `/api/jobs` | Create a job (assigns `J-0001`-style number, opens the timeline) |
| `GET` | `/api/jobs/:id` | One job with its full timeline |
| `PATCH` | `/api/jobs/:id` | Edit job fields — *not* status |
| `POST` | `/api/jobs/:id/status` | Move the job through the workflow, with an optional note |
| `GET` `POST` | `/api/jobs/:id/events` | Read or add timeline notes |
| `DELETE` | `/api/jobs/:id` | Delete a job and its timeline |
| `GET` `POST` | `/api/clients` | List/search or create clients |
| `GET` `PATCH` `DELETE` | `/api/clients/:id` | One client, with their jobs |

Phase 2:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/auth/status` | Whether this install still needs its first account |
| `POST` | `/api/auth/setup` | Create the first account (refused once one exists) |
| `POST` | `/api/auth/login` `/api/auth/logout` | Start or end a session |
| `GET` `POST` | `/api/users` | List accounts, or add a person |
| `GET` `POST` | `/api/expenses` | List (filter `job_id`, `category`, `vendor_id`, `from`, `to`, `overhead`) or record |
| `GET` `PATCH` `DELETE` | `/api/expenses/:id` | One expense |
| `POST` | `/api/expenses/:id/receipt` | Upload a receipt as a raw body |
| `GET` `DELETE` | `/api/attachments/:id` | Stream or remove a stored file |
| `GET` `POST` | `/api/vendors` | Vendors with their running totals |
| `GET` `PUT` | `/api/jobs/:id/budget` | Contract amount and budget lines |
| `GET` | `/api/jobs/:id/costs` | Spend by category, budget vs. actual, margin |
| `GET` | `/api/reports/spend` | Totals by month, category, vendor and job |

Phase 3:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` `POST` | `/api/leads` | Inbox (filter `status`, `open`) and capture |
| `GET` `PATCH` `DELETE` | `/api/leads/:id` | One lead |
| `POST` | `/api/leads/:id/convert` | Lead → client + job, in one transaction |
| `GET` `POST` | `/api/jobs/:id/estimates` | Versions for a job; `copy_from_estimate_id` revises |
| `GET` `PATCH` `DELETE` | `/api/estimates/:id` | One estimate — edits refused once sent |
| `POST` | `/api/estimates/:id/lines` | Add a line |
| `PATCH` `DELETE` | `/api/estimate-lines/:id` | Edit or remove a line |
| `POST` | `/api/estimates/:id/send` `accept` `decline` | The three decisions |
| `GET` | `/api/invoices` | Receivables (`status=outstanding` / `overdue`) |
| `GET` `POST` | `/api/jobs/:id/invoices` | Invoices for a job (`from`: estimate, expenses, empty) |
| `GET` `PATCH` `DELETE` | `/api/invoices/:id` | One invoice |
| `POST` | `/api/invoices/:id/lines` | Add a line |
| `PATCH` `DELETE` | `/api/invoice-lines/:id` | Edit or remove a line |
| `POST` | `/api/invoices/:id/send` `void` | Issue it, or void it |
| `GET` `POST` | `/api/invoices/:id/payments` | Record a payment; status follows |
| `DELETE` | `/api/payments/:id` | Remove a payment; status follows back |
| `GET` `POST` | `/api/jobs/:id/photos` | Gallery and upload (`stage`, `caption`) |
| `PATCH` `DELETE` | `/api/photos/:id` | Re-stage, re-caption or delete |
| `GET` | `/api/reports/executive` | Win rate, backlog, receivables, finished-job margin |

Amounts are sent as dollars (`"1,240.55"`, `1240.55` or `"1240"`) and always
come back as integer cents (`amount_cents`). Improperly grouped input like
`"1,2,3"` is refused rather than silently reinterpreted.

Status changes go through their own endpoint rather than `PATCH`, so that no
status can ever change without a timeline entry being written in the same
transaction.

```sh
curl -X POST localhost:4000/api/jobs \
  -H 'content-type: application/json' \
  -d '{"title":"Deck rebuild","client_id":1,"start_date":"2026-10-02"}'

curl -X POST localhost:4000/api/jobs/1/status \
  -H 'content-type: application/json' \
  -d '{"status":"scheduled","note":"Signed, deposit received","author":"Mike"}'
```

---

## How it's built

```
src/
  server.js            HTTP server, auth gate, routing, static files
  db.js                SQLite connection + migration runner
  seed.js              demo data
  migrations/*.sql     schema, applied in order, once each
  lib/
    http.js            router, JSON helpers, HttpError
    validate.js        input validation
    workflow.js        the job lifecycle and its legal transitions
    money.js           dollars to whole cents, no floats
    auth.js            scrypt hashing, sessions, login throttling
    uploads.js         streamed uploads with magic-byte type checks
  routes/              auth, clients, jobs, dashboard, expenses,
                       leads, estimates, invoices, photos, executive
public/
  app.js               router and boot
  ui.js                fetch wrapper, formatting, cards, modal form
  views-core.js        dashboard, jobs, clients
  views-money.js       expenses, receipts, job costing, reports
  views-leads.js       the lead inbox and conversion
  views-estimates.js   the estimate builder
  views-invoices.js    invoices, payments, receivables
  views-photos.js      the job photo gallery
  views-auth.js        sign-in and the account menu
bin/                   user.js, backup.sh, make-icons.js
deploy/                systemd service + nightly backup timer
test/                  API tests (node --test)
```

Deliberate choices worth knowing before you extend it:

- **No dependencies.** Nothing to audit, nothing to update, no lockfile drift.
  A tool that a small business relies on shouldn't rot because a transitive
  dependency was unpublished.
- **SQLite in one file.** Copy it to back it up; email it to move it.
- **Migrations are plain SQL files** applied in filename order and recorded in
  `schema_migrations`. Phase 2 adds `002_phase2_financials.sql`; nothing
  already applied is ever edited.
- **The workflow lives in one module** (`src/lib/workflow.js`). Changing the
  lifecycle means editing that table, not hunting through the routes.
- **Records that were shown to a customer are immutable.** A sent estimate and
  an issued invoice can be superseded or voided, never edited or deleted.
- **Derived state is derived every time.** An invoice's status is recomputed
  from its payments on every change rather than being a field anyone can set.
- **Uploads are raw bodies, not multipart.** The only client is ours, and a
  hand-rolled multipart parser is a liability rather than a feature.
- **The file's leading bytes decide its type**, never the `Content-Type` the
  client sent.

## Testing

```sh
npm test
```

77 tests across three suites.

`test/api.test.js` (phase 1) covers client and job CRUD, every legal transition
in sequence, rejection of illegal ones (and that a rejected move leaves no
trace), date validation, filtering, cascade behaviour, and the dashboard buckets.

`test/money.test.js` (phase 2) covers cent parsing including the float traps and
malformed thousands separators, that every data route refuses an anonymous
request, that no plaintext password or raw session token is stored, expense CRUD
and filtering, receipt uploads (generated names, a rejected disguised file, the
size cap, cleanup on delete, no anonymous reads), budgets and margin arithmetic,
subcontractor spend counting against the labor line, expenses outliving a
deleted job, and report rollups summing to their totals.

`test/operations.test.js` (phase 3) covers lead capture and conversion into a
client and job, that a sent estimate refuses every kind of edit and that its
revision leaves version 1 untouched, that accepting sets the contract and closes
the other versions, that an invoice built from an estimate matches it to the
cent, that the invoice status follows its payments in both directions, that
overpayment and paying an unsent invoice are refused, that a job with invoices
cannot be deleted, photo staging and the PDF refusal leaving nothing on disk,
and that the executive report's aging buckets account for every outstanding
cent.

## Security posture

Phase 2 holds financial records on a home network, so the prerequisites the
roadmap set for it are done rather than deferred:

1. **Authentication** on every data route. Only `/api/health` and the sign-in
   endpoints are reachable without a session.
2. **Upload validation** — magic-byte type checks, a 12 MB cap enforced while
   streaming, generated filenames, `0600` files in a `0700` directory outside
   the web root, and no anonymous reads.
3. **Backups** — `npm run backup` takes a consistent snapshot of a running
   database plus the receipts; `deploy/` has a systemd timer that runs it
   nightly and keeps 30 days.
4. **Security headers** — a content security policy, `nosniff`, `DENY` framing,
   and `HttpOnly` `SameSite=Lax` session cookies (`Secure` once TLS is on).

Two things it deliberately does **not** do:

- **It serves plain HTTP by default.** On a home LAN that is a reasonable
  trade; `TLS_CERT` and `TLS_KEY` turn on HTTPS if you would rather not make it.
- **It is not built to face the internet.** No port forwarding. If it is needed
  from the road, use a VPN into the home network — `docs/DEPLOY.md` explains.
