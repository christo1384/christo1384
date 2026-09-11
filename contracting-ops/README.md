# Contracting Ops

A backend operations system for a general contracting business — leads, bids,
jobs, receipts, invoicing, all in one place instead of spread across a phone,
a truck console and a shoebox of receipts.

It is built in **phases**, so the business gets something usable immediately
rather than waiting for the whole system:

| Phase | Scope | Status |
| ----- | ----- | ------ |
| **1** | Jobs and their status — clients, the job lifecycle, a timeline per job, a dashboard of what needs attention | **Built and working** |
| 2 | Financials — receipts, expense tracking, job costing, budget vs. actual | Specified, not built |
| 3 | Executive + operations — leads and bids, estimates, job photos, invoicing, reporting | Specified, not built |
| 4 | Marketing — referral tracking, review requests, campaign attribution | Deferred (booked solid) |

Phases 2–4 are specified in [`docs/ROADMAP.md`](docs/ROADMAP.md): tables,
columns, endpoints and acceptance criteria, ready to build in order.

---

## Running it

Requires **Node 22.5 or newer**. There are no dependencies to install — the
server uses Node's built-in HTTP and SQLite modules, and the frontend is plain
HTML, CSS and JavaScript with no build step.

```sh
npm run seed     # optional: load demo clients and jobs
npm start        # http://localhost:4000
```

| Command | What it does |
| ------- | ------------ |
| `npm start` | Runs the server on port 4000 (`PORT=8080 npm start` to change it) |
| `npm run dev` | Same, restarting on file changes |
| `npm run seed` | Loads demo data; `npm run seed -- --force` replaces what's there |
| `npm test` | Runs the API test suite |

Everything lives in one file: `data/ops.db`. Back it up by copying it.
`DB_FILE=/path/to/other.db npm start` points at a different one.

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
  server.js            HTTP server, routing, static files
  db.js                SQLite connection + migration runner
  seed.js              demo data
  migrations/*.sql     schema, applied in order, once each
  lib/
    http.js            router, JSON helpers, HttpError
    validate.js        input validation
    workflow.js        the job lifecycle and its legal transitions
  routes/              clients, jobs, dashboard
public/                index.html, app.js, styles.css
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
- **The API is not authenticated.** It is built to run on one machine or a
  private network. See "Before it holds real money" below.

## Testing

```sh
npm test
```

19 tests covering client and job CRUD, every legal transition in sequence,
rejection of illegal ones (and that a rejected move leaves no trace), date
validation, filtering, cascade behaviour, and the dashboard buckets.

## Before it holds real money

Phase 1 is a tracking tool for one household. Phase 2 introduces receipts and
expenses — real financial records — and these should land with it:

1. **Authentication.** Even a single shared password and a session cookie.
2. **HTTPS**, if it is reachable from anywhere but localhost.
3. **Automated backups.** A nightly copy of `data/ops.db` somewhere off the
   machine. SQLite makes this a file copy; there is no excuse for skipping it.
4. **Uploaded-file limits.** Receipt and photo uploads need size and MIME
   checks before they touch disk.

These are listed as explicit prerequisites in the Phase 2 section of the
roadmap rather than left as an afterthought.
