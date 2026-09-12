import { sendJson } from '../lib/http.js';
import { STATUSES, PRIORITIES, groupKeys, statusLabel } from '../lib/workflow.js';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from './expenses.js';
import { LEAD_STATUSES, LEAD_SOURCES } from './leads.js';
import { ESTIMATE_STATUSES, UNITS } from './estimates.js';
import { INVOICE_STATUSES, PAYMENT_METHODS as INVOICE_PAYMENT_METHODS } from './invoices.js';
import { PHOTO_STAGES } from './photos.js';

const STALE_DAYS = 7;
const UPCOMING_DAYS = 14;

export function registerDashboardRoutes(router, db) {
  router.get('/api/meta', (req, res) => {
    sendJson(res, 200, {
      statuses: STATUSES,
      priorities: PRIORITIES,
      stale_days: STALE_DAYS,
      expense_categories: EXPENSE_CATEGORIES,
      expense_payment_methods: PAYMENT_METHODS,
      lead_statuses: LEAD_STATUSES,
      lead_sources: LEAD_SOURCES,
      estimate_statuses: ESTIMATE_STATUSES,
      units: UNITS,
      invoice_statuses: INVOICE_STATUSES,
      payment_methods: INVOICE_PAYMENT_METHODS,
      photo_stages: PHOTO_STAGES,
    });
  });

  router.get('/api/dashboard', (req, res) => {
    const counts = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all()
        .map((r) => [r.status, r.n]),
    );
    const total = (keys) => keys.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
    const activeKeys = groupKeys('active');
    const openKeys = [...groupKeys('pipeline'), ...activeKeys];

    const placeholders = (keys) => keys.map(() => '?').join(', ');

    // Open jobs whose last timeline entry is older than STALE_DAYS — the "who
    // have I not touched in a week" list, which is the whole point of phase one.
    const stale = db.prepare(
      `SELECT j.id, j.job_number, j.title, j.status, j.priority, c.name AS client_name,
              (SELECT MAX(created_at) FROM job_events e WHERE e.job_id = j.id) AS last_activity_at
         FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
        WHERE j.status IN (${placeholders(openKeys)})
          AND COALESCE((SELECT MAX(created_at) FROM job_events e WHERE e.job_id = j.id), j.updated_at)
              < datetime('now', ?)
        ORDER BY last_activity_at ASC
        LIMIT 20`,
    ).all(...openKeys, `-${STALE_DAYS} days`);

    const upcoming = db.prepare(
      `SELECT j.id, j.job_number, j.title, j.status, j.priority, j.start_date, c.name AS client_name
         FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
        WHERE j.start_date IS NOT NULL
          AND j.start_date BETWEEN date('now') AND date('now', ?)
          AND j.status IN (${placeholders(openKeys)})
        ORDER BY j.start_date ASC`,
    ).all(`+${UPCOMING_DAYS} days`, ...openKeys);

    const overdue = db.prepare(
      `SELECT j.id, j.job_number, j.title, j.status, j.target_end_date, c.name AS client_name
         FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
        WHERE j.target_end_date IS NOT NULL
          AND j.target_end_date < date('now')
          AND j.status IN (${placeholders(activeKeys)})
        ORDER BY j.target_end_date ASC`,
    ).all(...activeKeys);

    const recent = db.prepare(
      `SELECT e.*, j.job_number, j.title
         FROM job_events e JOIN jobs j ON j.id = e.job_id
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 15`,
    ).all();

    sendJson(res, 200, {
      totals: {
        pipeline: total(groupKeys('pipeline')),
        active: total(activeKeys),
        closed: total(groupKeys('closed')),
        all: total(Object.keys(counts)),
      },
      by_status: STATUSES.map((s) => ({ ...s, count: counts[s.key] ?? 0 })),
      stale_after_days: STALE_DAYS,
      stale,
      upcoming,
      overdue,
      recent: recent.map((e) => ({ ...e, summary: summarize(e) })),
    });
  });
}

function summarize(event) {
  if (event.kind === 'status_change') {
    return `${statusLabel(event.from_status)} → ${statusLabel(event.to_status)}`;
  }
  if (event.kind === 'created') return 'Job created';
  return event.body ?? '';
}
