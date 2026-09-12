import { sendJson } from '../lib/http.js';
import { groupKeys } from '../lib/workflow.js';

/**
 * The four questions a contractor actually asks about the business:
 * am I winning work, how much is on the books, who owes me, and did the
 * finished jobs make money.
 */
export function registerExecutiveRoutes(router, db) {
  router.get('/api/reports/executive', (req, res) => {
    sendJson(res, 200, {
      leads: leadPerformance(db),
      estimates: estimatePerformance(db),
      backlog: backlog(db),
      receivables: receivables(db),
      completed_jobs: completedMargins(db),
    });
  });
}

function leadPerformance(db) {
  const counts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all().map((r) => [r.status, r.n]),
  );
  const converted = counts.converted ?? 0;
  const lost = counts.lost ?? 0;
  const decided = converted + lost;

  return {
    counts,
    open: (counts.new ?? 0) + (counts.contacted ?? 0) + (counts.qualified ?? 0),
    converted,
    lost,
    win_rate_percent: decided ? Math.round((converted / decided) * 1000) / 10 : null,
    by_source: db.prepare(
      `SELECT COALESCE(source, 'unknown') AS source,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted
         FROM leads GROUP BY source ORDER BY total DESC`,
    ).all(),
  };
}

function estimatePerformance(db) {
  const rows = db.prepare(
    `SELECT e.id, e.status,
            COALESCE((SELECT SUM(ROUND(l.quantity * l.unit_cost_cents))
                        FROM estimate_lines l WHERE l.estimate_id = e.id), 0) AS subtotal_cents,
            e.markup_percent
       FROM estimates e`,
  ).all().map((r) => ({
    ...r,
    total_cents: r.subtotal_cents + Math.round(r.subtotal_cents * (r.markup_percent / 100)),
  }));

  const sum = (status) => rows.filter((r) => r.status === status).reduce((n, r) => n + r.total_cents, 0);
  const count = (status) => rows.filter((r) => r.status === status).length;
  const decided = count('accepted') + count('declined');

  return {
    draft_count: count('draft'),
    sent_count: count('sent'),
    accepted_count: count('accepted'),
    declined_count: count('declined'),
    win_rate_percent: decided ? Math.round((count('accepted') / decided) * 1000) / 10 : null,
    out_for_decision_cents: sum('sent'),
    won_cents: sum('accepted'),
  };
}

function backlog(db) {
  const activeKeys = groupKeys('active');
  const placeholders = activeKeys.map(() => '?').join(', ');

  const jobs = db.prepare(
    `SELECT j.id, j.job_number, j.title, j.status, j.start_date,
            b.contract_cents,
            COALESCE((SELECT SUM(e.amount_cents) FROM expenses e WHERE e.job_id = j.id), 0) AS spent_cents
       FROM jobs j LEFT JOIN job_budgets b ON b.job_id = j.id
      WHERE j.status IN (${placeholders})
      ORDER BY COALESCE(j.start_date, '9999-12-31')`,
  ).all(...activeKeys);

  const contract = jobs.reduce((n, j) => n + (j.contract_cents ?? 0), 0);
  const spent = jobs.reduce((n, j) => n + j.spent_cents, 0);

  return {
    job_count: jobs.length,
    unpriced_count: jobs.filter((j) => j.contract_cents === null).length,
    contract_cents: contract,
    spent_cents: spent,
    expected_margin_cents: contract - spent,
    jobs,
  };
}

function receivables(db) {
  const rows = db.prepare(
    `SELECT i.id, i.invoice_number, i.status, i.issued_on, i.due_on,
            j.id AS job_id, j.job_number, c.name AS client_name,
            COALESCE((SELECT SUM(ROUND(l.quantity * l.unit_price_cents))
                        FROM invoice_lines l WHERE l.invoice_id = i.id), 0) AS total_cents,
            COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
       FROM invoices i JOIN jobs j ON j.id = i.job_id
       LEFT JOIN clients c ON c.id = j.client_id
      WHERE i.status IN ('sent', 'partial')
      ORDER BY i.due_on`,
  ).all().map((r) => ({ ...r, balance_cents: r.total_cents - r.paid_cents, days_overdue: overdueDays(r.due_on) }));

  const bucket = (min, max) => rows
    .filter((r) => r.days_overdue >= min && (max === null || r.days_overdue <= max))
    .reduce((n, r) => n + r.balance_cents, 0);

  return {
    outstanding_cents: rows.reduce((n, r) => n + r.balance_cents, 0),
    overdue_cents: rows.filter((r) => r.days_overdue > 0).reduce((n, r) => n + r.balance_cents, 0),
    aging: [
      { label: 'Not yet due', cents: rows.filter((r) => r.days_overdue === 0).reduce((n, r) => n + r.balance_cents, 0) },
      { label: '1-30 days', cents: bucket(1, 30) },
      { label: '31-60 days', cents: bucket(31, 60) },
      { label: '60+ days', cents: bucket(61, null) },
    ],
    invoices: rows,
  };
}

function completedMargins(db) {
  return db.prepare(
    `SELECT j.id, j.job_number, j.title, j.status,
            b.contract_cents,
            COALESCE((SELECT SUM(e.amount_cents) FROM expenses e WHERE e.job_id = j.id), 0) AS spent_cents
       FROM jobs j LEFT JOIN job_budgets b ON b.job_id = j.id
      WHERE j.status = 'complete'
      ORDER BY j.updated_at DESC
      LIMIT 20`,
  ).all().map((j) => ({
    ...j,
    margin_cents: j.contract_cents === null ? null : j.contract_cents - j.spent_cents,
    margin_percent: j.contract_cents
      ? Math.round(((j.contract_cents - j.spent_cents) / j.contract_cents) * 1000) / 10
      : null,
  }));
}

function overdueDays(dueOn) {
  if (!dueOn) return 0;
  const days = Math.floor((Date.now() - new Date(`${dueOn}T12:00:00Z`)) / 86400000);
  return days > 0 ? days : 0;
}
