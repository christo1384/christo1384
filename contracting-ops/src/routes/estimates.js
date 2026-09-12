import { sendJson, readJson, notFound, badRequest } from '../lib/http.js';
import {
  requiredText, optionalText, optionalEnum, requiredEnum, optionalDate, requiredNumber, pathId,
} from '../lib/validate.js';
import { requiredCents } from '../lib/money.js';
import { transaction } from '../db.js';
import { canTransition, statusLabel } from '../lib/workflow.js';

export const ESTIMATE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'];
export const UNITS = ['ea', 'lf', 'sf', 'sy', 'cy', 'hr', 'day', 'ls'];
const EDITABLE = 'draft';

export function registerEstimateRoutes(router, db) {
  router.get('/api/jobs/:id/estimates', (req, res, { params }) => {
    const jobId = pathId(params);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) throw notFound('Job not found');
    const rows = db.prepare('SELECT * FROM estimates WHERE job_id = ? ORDER BY version DESC').all(jobId);
    sendJson(res, 200, rows.map((e) => withTotals(db, e)));
  });

  router.post('/api/jobs/:id/estimates', async (req, res, { params, user }) => {
    const jobId = pathId(params);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) throw notFound('Job not found');
    const body = await readJson(req);

    // Copying an earlier version is how a revision starts: the customer asked
    // for a change, not for a blank page.
    const copyFrom = body.copy_from_estimate_id
      ? getEstimate(db, Number(body.copy_from_estimate_id))
      : null;
    if (body.copy_from_estimate_id && (!copyFrom || copyFrom.job_id !== jobId)) {
      throw badRequest('copy_from_estimate_id is not an estimate on this job');
    }

    const estimate = transaction(db, () => {
      const nextVersion = (db.prepare(
        'SELECT COALESCE(MAX(version), 0) AS v FROM estimates WHERE job_id = ?',
      ).get(jobId).v) + 1;

      const id = Number(db.prepare(
        `INSERT INTO estimates (job_id, version, markup_percent, valid_until, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        jobId, nextVersion,
        body.markup_percent !== undefined ? requiredNumber(body, 'markup_percent', { min: 0, max: 500 })
          : (copyFrom?.markup_percent ?? 0),
        optionalDate(body, 'valid_until') ?? null,
        optionalText(body, 'notes') ?? copyFrom?.notes ?? null,
        user?.id ?? null,
      ).lastInsertRowid);

      if (copyFrom) {
        db.prepare(
          `INSERT INTO estimate_lines (estimate_id, sort_order, description, quantity, unit, unit_cost_cents, category)
           SELECT ?, sort_order, description, quantity, unit, unit_cost_cents, category
             FROM estimate_lines WHERE estimate_id = ?`,
        ).run(id, copyFrom.id);
      }
      return getEstimate(db, id);
    });

    sendJson(res, 201, estimate);
  });

  router.get('/api/estimates/:id', (req, res, { params }) => {
    const estimate = getEstimate(db, pathId(params));
    if (!estimate) throw notFound('Estimate not found');
    sendJson(res, 200, estimate);
  });

  router.patch('/api/estimates/:id', async (req, res, { params }) => {
    const estimate = mustBeEditable(db, pathId(params));
    const body = await readJson(req);

    if ('status' in body) {
      throw badRequest('Use the send, accept or decline endpoints to change an estimate’s status');
    }

    const updates = [];
    const values = [];
    if (body.markup_percent !== undefined) {
      updates.push('markup_percent = ?');
      values.push(requiredNumber(body, 'markup_percent', { min: 0, max: 500 }));
    }
    if ('valid_until' in body) { updates.push('valid_until = ?'); values.push(optionalDate(body, 'valid_until')); }
    if ('notes' in body) { updates.push('notes = ?'); values.push(optionalText(body, 'notes')); }
    if (updates.length) db.prepare(`UPDATE estimates SET ${updates.join(', ')} WHERE id = ?`).run(...values, estimate.id);

    sendJson(res, 200, getEstimate(db, estimate.id));
  });

  /* ------------------------------- lines ------------------------------- */

  router.post('/api/estimates/:id/lines', async (req, res, { params }) => {
    const estimate = mustBeEditable(db, pathId(params));
    const body = await readJson(req);

    const nextOrder = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM estimate_lines WHERE estimate_id = ?',
    ).get(estimate.id).n;

    db.prepare(
      `INSERT INTO estimate_lines (estimate_id, sort_order, description, quantity, unit, unit_cost_cents, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      estimate.id,
      body.sort_order !== undefined ? requiredNumber(body, 'sort_order', { min: 0, max: 9999 }) : nextOrder,
      requiredText(body, 'description', { max: 300 }),
      body.quantity === undefined ? 1 : requiredNumber(body, 'quantity', { min: 0, max: 1e6 }),
      optionalEnum(body, 'unit', UNITS) ?? null,
      requiredCents(body, 'unit_cost'),
      optionalText(body, 'category', { max: 60 }) ?? null,
    );
    sendJson(res, 201, getEstimate(db, estimate.id));
  });

  router.patch('/api/estimate-lines/:id', async (req, res, { params }) => {
    const lineId = pathId(params);
    const line = db.prepare('SELECT * FROM estimate_lines WHERE id = ?').get(lineId);
    if (!line) throw notFound('Line not found');
    mustBeEditable(db, line.estimate_id);
    const body = await readJson(req);

    const updates = [];
    const values = [];
    if ('description' in body) { updates.push('description = ?'); values.push(requiredText(body, 'description', { max: 300 })); }
    if ('quantity' in body) { updates.push('quantity = ?'); values.push(requiredNumber(body, 'quantity', { min: 0, max: 1e6 })); }
    if ('unit' in body) { updates.push('unit = ?'); values.push(optionalEnum(body, 'unit', UNITS)); }
    if ('unit_cost' in body) { updates.push('unit_cost_cents = ?'); values.push(requiredCents(body, 'unit_cost')); }
    if ('category' in body) { updates.push('category = ?'); values.push(optionalText(body, 'category', { max: 60 })); }
    if ('sort_order' in body) { updates.push('sort_order = ?'); values.push(requiredNumber(body, 'sort_order', { min: 0, max: 9999 })); }
    if (updates.length) db.prepare(`UPDATE estimate_lines SET ${updates.join(', ')} WHERE id = ?`).run(...values, lineId);

    sendJson(res, 200, getEstimate(db, line.estimate_id));
  });

  router.delete('/api/estimate-lines/:id', (req, res, { params }) => {
    const line = db.prepare('SELECT * FROM estimate_lines WHERE id = ?').get(pathId(params));
    if (!line) throw notFound('Line not found');
    mustBeEditable(db, line.estimate_id);
    db.prepare('DELETE FROM estimate_lines WHERE id = ?').run(line.id);
    sendJson(res, 200, getEstimate(db, line.estimate_id));
  });

  /* ------------------------------ decisions ----------------------------- */

  router.post('/api/estimates/:id/send', async (req, res, { params, user }) => {
    const estimate = getEstimate(db, pathId(params));
    if (!estimate) throw notFound('Estimate not found');
    if (estimate.status !== 'draft') throw badRequest(`This estimate is already ${estimate.status}`);
    if (!estimate.lines.length) throw badRequest('Add at least one line before sending an estimate');

    const moved = transaction(db, () => {
      db.prepare("UPDATE estimates SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(estimate.id);
      return moveJob(db, estimate.job_id, 'bid_sent',
        `Estimate v${estimate.version} sent — ${formatCents(estimate.total_cents)}`, user);
    });

    sendJson(res, 200, { ...getEstimate(db, estimate.id), job_moved_to: moved });
  });

  router.post('/api/estimates/:id/accept', async (req, res, { params, user }) => {
    const estimate = getEstimate(db, pathId(params));
    if (!estimate) throw notFound('Estimate not found');
    if (!['sent', 'expired'].includes(estimate.status)) {
      throw badRequest('Only an estimate that has been sent can be accepted');
    }

    const moved = transaction(db, () => {
      db.prepare("UPDATE estimates SET status = 'accepted', decided_at = datetime('now') WHERE id = ?")
        .run(estimate.id);
      // Losing versions are closed out so only one estimate is ever live.
      db.prepare(
        `UPDATE estimates SET status = 'declined', decided_at = datetime('now')
          WHERE job_id = ? AND id != ? AND status IN ('draft', 'sent', 'expired')`,
      ).run(estimate.job_id, estimate.id);

      // An accepted estimate is the contract amount, so the job's budget
      // starts from the number the customer actually agreed to.
      db.prepare(
        `INSERT INTO job_budgets (job_id, contract_cents) VALUES (?, ?)
         ON CONFLICT(job_id) DO UPDATE SET contract_cents = excluded.contract_cents,
                                           updated_at = datetime('now')`,
      ).run(estimate.job_id, estimate.total_cents);

      return moveJob(db, estimate.job_id, 'scheduled',
        `Estimate v${estimate.version} accepted — ${formatCents(estimate.total_cents)}`, user);
    });

    sendJson(res, 200, { ...getEstimate(db, estimate.id), job_moved_to: moved });
  });

  router.post('/api/estimates/:id/decline', async (req, res, { params, user }) => {
    const estimate = getEstimate(db, pathId(params));
    if (!estimate) throw notFound('Estimate not found');
    if (!['sent', 'expired'].includes(estimate.status)) {
      throw badRequest('Only an estimate that has been sent can be declined');
    }
    const body = await readJson(req);

    db.prepare("UPDATE estimates SET status = 'declined', decided_at = datetime('now') WHERE id = ?")
      .run(estimate.id);
    logEvent(db, estimate.job_id,
      `Estimate v${estimate.version} declined${body.reason ? `: ${String(body.reason).slice(0, 300)}` : ''}`, user);

    sendJson(res, 200, getEstimate(db, estimate.id));
  });

  router.delete('/api/estimates/:id', (req, res, { params }) => {
    const estimate = getEstimate(db, pathId(params));
    if (!estimate) throw notFound('Estimate not found');
    if (estimate.status !== 'draft') {
      throw badRequest('An estimate that has been sent is a record of what the customer saw and cannot be deleted');
    }
    db.prepare('DELETE FROM estimates WHERE id = ?').run(estimate.id);
    sendJson(res, 200, { deleted: estimate.id });
  });
}

/* ------------------------------- helpers ------------------------------- */

function mustBeEditable(db, id) {
  const estimate = getEstimate(db, id);
  if (!estimate) throw notFound('Estimate not found');
  if (estimate.status !== EDITABLE) {
    throw badRequest(
      `Estimate v${estimate.version} has been ${estimate.status} and cannot be changed. `
      + 'Create a new version instead.',
      { estimate_id: estimate.id, job_id: estimate.job_id, status: estimate.status },
    );
  }
  return estimate;
}

export function getEstimate(db, id) {
  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(id);
  return row ? withTotals(db, row) : null;
}

/** Per-line rounding first, then markup: the customer sees the line totals. */
export function withTotals(db, estimate) {
  const lines = db.prepare(
    'SELECT * FROM estimate_lines WHERE estimate_id = ? ORDER BY sort_order, id',
  ).all(estimate.id).map((l) => ({ ...l, line_total_cents: Math.round(l.quantity * l.unit_cost_cents) }));

  const subtotal = lines.reduce((sum, l) => sum + l.line_total_cents, 0);
  const markup = Math.round(subtotal * (estimate.markup_percent / 100));

  return {
    ...estimate,
    lines,
    subtotal_cents: subtotal,
    markup_cents: markup,
    total_cents: subtotal + markup,
    editable: estimate.status === EDITABLE,
  };
}

/** Moves the job if the workflow allows it; returns the status it landed on. */
function moveJob(db, jobId, to, note, user) {
  const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
  if (!job) return null;

  if (job.status === to || !canTransition(job.status, to)) {
    logEvent(db, jobId, note, user);
    return job.status;
  }
  db.prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, jobId);
  db.prepare(
    `INSERT INTO job_events (job_id, kind, from_status, to_status, body, author)
     VALUES (?, 'status_change', ?, ?, ?, ?)`,
  ).run(jobId, job.status, to, note, user?.display_name ?? null);
  return to;
}

function logEvent(db, jobId, note, user) {
  db.prepare("INSERT INTO job_events (job_id, kind, body, author) VALUES (?, 'note', ?, ?)")
    .run(jobId, note, user?.display_name ?? null);
  db.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").run(jobId);
}

const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;
