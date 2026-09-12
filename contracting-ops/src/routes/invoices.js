import { sendJson, readJson, notFound, badRequest } from '../lib/http.js';
import {
  requiredText, optionalText, optionalEnum, optionalDate, requiredDate, requiredNumber, pathId,
} from '../lib/validate.js';
import { requiredCents } from '../lib/money.js';
import { transaction } from '../db.js';
import { getEstimate } from './estimates.js';

export const INVOICE_STATUSES = ['draft', 'sent', 'partial', 'paid', 'void'];
export const PAYMENT_METHODS = ['check', 'ach', 'card', 'cash'];
const DEFAULT_TERMS_DAYS = 14;

export function registerInvoiceRoutes(router, db) {
  router.get('/api/invoices', (req, res, { query }) => {
    const where = [];
    const args = {};

    const status = query.get('status');
    if (status === 'overdue') {
      where.push("i.status IN ('sent', 'partial') AND i.due_on IS NOT NULL AND i.due_on < date('now')");
    } else if (status === 'outstanding') {
      where.push("i.status IN ('sent', 'partial')");
    } else if (status) {
      if (!INVOICE_STATUSES.includes(status)) throw badRequest(`Unknown invoice status: ${status}`);
      where.push('i.status = :status');
      args.status = status;
    }
    if (query.get('job_id')) { where.push('i.job_id = :job_id'); args.job_id = Number(query.get('job_id')); }

    const rows = db.prepare(
      `SELECT i.*, j.job_number, j.title AS job_title, c.name AS client_name
         FROM invoices i
         JOIN jobs j ON j.id = i.job_id
         LEFT JOIN clients c ON c.id = j.client_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY COALESCE(i.due_on, i.issued_on, i.created_at) DESC, i.id DESC`,
    ).all(args).map((row) => withTotals(db, row));

    const totals = rows.reduce((acc, r) => ({
      count: acc.count + 1,
      invoiced_cents: acc.invoiced_cents + r.total_cents,
      paid_cents: acc.paid_cents + r.paid_cents,
      outstanding_cents: acc.outstanding_cents + (r.status === 'void' ? 0 : r.balance_cents),
    }), { count: 0, invoiced_cents: 0, paid_cents: 0, outstanding_cents: 0 });

    sendJson(res, 200, { totals, invoices: rows });
  });

  router.get('/api/jobs/:id/invoices', (req, res, { params }) => {
    const jobId = pathId(params);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) throw notFound('Job not found');
    sendJson(res, 200, db.prepare('SELECT * FROM invoices WHERE job_id = ? ORDER BY id DESC')
      .all(jobId).map((row) => withTotals(db, row)));
  });

  /**
   * An invoice can start from an accepted estimate (the usual case), from the
   * job's actual expenses, or empty. Starting from the estimate is what keeps
   * the billed amount matching what the customer agreed to.
   */
  router.post('/api/jobs/:id/invoices', async (req, res, { params, user }) => {
    const jobId = pathId(params);
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) throw notFound('Job not found');
    const body = await readJson(req);

    const from = optionalEnum(body, 'from', ['estimate', 'expenses', 'empty']) ?? 'empty';
    let sourceLines = [];

    if (from === 'estimate') {
      const estimateId = body.estimate_id
        ? Number(body.estimate_id)
        : db.prepare("SELECT id FROM estimates WHERE job_id = ? AND status = 'accepted' ORDER BY version DESC")
          .get(jobId)?.id;
      if (!estimateId) throw badRequest('This job has no accepted estimate to invoice from');

      const estimate = getEstimate(db, estimateId);
      if (!estimate || estimate.job_id !== jobId) throw badRequest('estimate_id is not an estimate on this job');

      // Lines are copied at cost and the markup is billed as its own line.
      // Spreading a percentage across rounded unit prices does not reliably sum
      // back to the estimate total; a separate line is exact by construction,
      // and the customer can see what they agreed to.
      sourceLines = estimate.lines.map((l, index) => ({
        sort_order: index,
        description: l.unit && l.quantity !== 1
          ? `${l.description} (${l.quantity} ${l.unit})`
          : l.description,
        quantity: l.quantity,
        unit_price_cents: l.unit_cost_cents,
      }));

      if (estimate.markup_cents !== 0) {
        sourceLines.push({
          sort_order: sourceLines.length,
          description: `Overhead and profit (${estimate.markup_percent}%)`,
          quantity: 1,
          unit_price_cents: estimate.markup_cents,
        });
      }
    } else if (from === 'expenses') {
      sourceLines = db.prepare(
        `SELECT category, SUM(amount_cents) AS cents FROM expenses
          WHERE job_id = ? AND billable = 1 GROUP BY category ORDER BY cents DESC`,
      ).all(jobId).map((r, index) => ({
        sort_order: index,
        description: `${r.category[0].toUpperCase()}${r.category.slice(1)}`,
        quantity: 1,
        unit_price_cents: r.cents,
      }));
      if (!sourceLines.length) throw badRequest('This job has no billable expenses to invoice');
    }

    const invoice = transaction(db, () => {
      const id = Number(db.prepare(
        `INSERT INTO invoices (job_id, invoice_number, issued_on, due_on, notes, created_by)
         VALUES (?, 'pending', ?, ?, ?, ?)`,
      ).run(
        jobId,
        optionalDate(body, 'issued_on') ?? null,
        optionalDate(body, 'due_on') ?? null,
        optionalText(body, 'notes') ?? null,
        user?.id ?? null,
      ).lastInsertRowid);

      db.prepare('UPDATE invoices SET invoice_number = ? WHERE id = ?')
        .run(`INV-${String(id).padStart(4, '0')}`, id);

      for (const line of sourceLines) {
        db.prepare(
          `INSERT INTO invoice_lines (invoice_id, sort_order, description, quantity, unit_price_cents)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(id, line.sort_order, line.description, line.quantity, line.unit_price_cents);
      }
      return getInvoice(db, id);
    });

    sendJson(res, 201, invoice);
  });

  router.get('/api/invoices/:id', (req, res, { params }) => {
    const invoice = getInvoice(db, pathId(params));
    if (!invoice) throw notFound('Invoice not found');
    sendJson(res, 200, invoice);
  });

  router.patch('/api/invoices/:id', async (req, res, { params }) => {
    const invoice = getInvoice(db, pathId(params));
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status === 'void') throw badRequest('A voided invoice cannot be edited');
    const body = await readJson(req);
    if ('status' in body) {
      throw badRequest('An invoice status follows its payments. Use the send or void endpoints.');
    }

    const updates = [];
    const values = [];
    if ('due_on' in body) { updates.push('due_on = ?'); values.push(optionalDate(body, 'due_on')); }
    if ('issued_on' in body) { updates.push('issued_on = ?'); values.push(optionalDate(body, 'issued_on')); }
    if ('notes' in body) { updates.push('notes = ?'); values.push(optionalText(body, 'notes')); }
    if (updates.length) db.prepare(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`).run(...values, invoice.id);

    recomputeStatus(db, invoice.id);
    sendJson(res, 200, getInvoice(db, invoice.id));
  });

  /* ------------------------------- lines ------------------------------- */

  router.post('/api/invoices/:id/lines', async (req, res, { params }) => {
    const invoice = mustBeOpen(db, pathId(params));
    const body = await readJson(req);

    const nextOrder = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM invoice_lines WHERE invoice_id = ?',
    ).get(invoice.id).n;

    db.prepare(
      `INSERT INTO invoice_lines (invoice_id, sort_order, description, quantity, unit_price_cents)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      invoice.id, nextOrder,
      requiredText(body, 'description', { max: 300 }),
      body.quantity === undefined ? 1 : requiredNumber(body, 'quantity', { min: 0, max: 1e6 }),
      requiredCents(body, 'unit_price'),
    );
    recomputeStatus(db, invoice.id);
    sendJson(res, 201, getInvoice(db, invoice.id));
  });

  router.patch('/api/invoice-lines/:id', async (req, res, { params }) => {
    const line = db.prepare('SELECT * FROM invoice_lines WHERE id = ?').get(pathId(params));
    if (!line) throw notFound('Line not found');
    mustBeOpen(db, line.invoice_id);
    const body = await readJson(req);

    const updates = [];
    const values = [];
    if ('description' in body) { updates.push('description = ?'); values.push(requiredText(body, 'description', { max: 300 })); }
    if ('quantity' in body) { updates.push('quantity = ?'); values.push(requiredNumber(body, 'quantity', { min: 0, max: 1e6 })); }
    if ('unit_price' in body) { updates.push('unit_price_cents = ?'); values.push(requiredCents(body, 'unit_price')); }
    if (updates.length) db.prepare(`UPDATE invoice_lines SET ${updates.join(', ')} WHERE id = ?`).run(...values, line.id);

    recomputeStatus(db, line.invoice_id);
    sendJson(res, 200, getInvoice(db, line.invoice_id));
  });

  router.delete('/api/invoice-lines/:id', (req, res, { params }) => {
    const line = db.prepare('SELECT * FROM invoice_lines WHERE id = ?').get(pathId(params));
    if (!line) throw notFound('Line not found');
    mustBeOpen(db, line.invoice_id);
    db.prepare('DELETE FROM invoice_lines WHERE id = ?').run(line.id);
    recomputeStatus(db, line.invoice_id);
    sendJson(res, 200, getInvoice(db, line.invoice_id));
  });

  /* ------------------------------ lifecycle ----------------------------- */

  router.post('/api/invoices/:id/send', async (req, res, { params, user }) => {
    const invoice = getInvoice(db, pathId(params));
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status === 'void') throw badRequest('A voided invoice cannot be sent');
    if (invoice.issued_on) throw badRequest('This invoice has already been issued');
    if (!invoice.lines.length) throw badRequest('Add at least one line before sending an invoice');
    const body = await readJson(req);

    const issuedOn = optionalDate(body, 'issued_on') ?? new Date().toISOString().slice(0, 10);
    const dueOn = optionalDate(body, 'due_on') ?? addDays(issuedOn, DEFAULT_TERMS_DAYS);

    db.prepare('UPDATE invoices SET issued_on = ?, due_on = ? WHERE id = ?').run(issuedOn, dueOn, invoice.id);
    recomputeStatus(db, invoice.id);
    logEvent(db, invoice.job_id,
      `Invoice ${invoice.invoice_number} sent — ${formatCents(invoice.total_cents)}, due ${dueOn}`, user);

    sendJson(res, 200, getInvoice(db, invoice.id));
  });

  router.post('/api/invoices/:id/void', async (req, res, { params, user }) => {
    const invoice = getInvoice(db, pathId(params));
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.paid_cents > 0) {
      throw badRequest('This invoice has payments against it. Refund or reverse them before voiding.');
    }
    db.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").run(invoice.id);
    logEvent(db, invoice.job_id, `Invoice ${invoice.invoice_number} voided`, user);
    sendJson(res, 200, getInvoice(db, invoice.id));
  });

  router.delete('/api/invoices/:id', (req, res, { params }) => {
    const invoice = getInvoice(db, pathId(params));
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.issued_on) {
      throw badRequest('An issued invoice is a financial record. Void it instead of deleting it.');
    }
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
    sendJson(res, 200, { deleted: invoice.id });
  });

  /* ------------------------------ payments ------------------------------ */

  router.get('/api/invoices/:id/payments', (req, res, { params }) => {
    const id = pathId(params);
    if (!getInvoice(db, id)) throw notFound('Invoice not found');
    sendJson(res, 200, paymentsFor(db, id));
  });

  router.post('/api/invoices/:id/payments', async (req, res, { params, user }) => {
    const invoice = getInvoice(db, pathId(params));
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status === 'void') throw badRequest('A voided invoice cannot take payments');
    if (!invoice.issued_on) throw badRequest('Send the invoice before recording a payment against it');
    const body = await readJson(req);

    const amount = requiredCents(body, 'amount');
    if (amount <= 0) throw badRequest('A payment must be a positive amount');
    if (amount > invoice.balance_cents) {
      throw badRequest(
        `That is more than the ${formatCents(invoice.balance_cents)} still owing on this invoice`,
        { balance_cents: invoice.balance_cents },
      );
    }

    db.prepare(
      `INSERT INTO payments (invoice_id, received_on, amount_cents, method, reference, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      invoice.id,
      requiredDate(body, 'received_on'),
      amount,
      optionalEnum(body, 'method', PAYMENT_METHODS) ?? null,
      optionalText(body, 'reference', { max: 100 }) ?? null,
      user?.id ?? null,
    );

    const after = recomputeStatus(db, invoice.id);
    logEvent(db, invoice.job_id,
      `Payment ${formatCents(amount)} on ${invoice.invoice_number}${after === 'paid' ? ' — paid in full' : ''}`,
      user);

    sendJson(res, 201, getInvoice(db, invoice.id));
  });

  router.delete('/api/payments/:id', (req, res, { params }) => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(pathId(params));
    if (!payment) throw notFound('Payment not found');
    db.prepare('DELETE FROM payments WHERE id = ?').run(payment.id);
    recomputeStatus(db, payment.invoice_id);
    sendJson(res, 200, { deleted: payment.id });
  });
}

/* ------------------------------- helpers ------------------------------- */

function mustBeOpen(db, id) {
  const invoice = getInvoice(db, id);
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status === 'void') throw badRequest('A voided invoice cannot be changed');
  if (invoice.paid_cents > 0) {
    throw badRequest('This invoice has been paid against. Void it and issue a corrected one.');
  }
  return invoice;
}

export function getInvoice(db, id) {
  const row = db.prepare(
    `SELECT i.*, j.job_number, j.title AS job_title, c.name AS client_name
       FROM invoices i JOIN jobs j ON j.id = i.job_id
       LEFT JOIN clients c ON c.id = j.client_id
      WHERE i.id = ?`,
  ).get(id);
  return row ? withTotals(db, row) : null;
}

export function withTotals(db, invoice) {
  const lines = db.prepare(
    'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id',
  ).all(invoice.id).map((l) => ({ ...l, line_total_cents: Math.round(l.quantity * l.unit_price_cents) }));

  const total = lines.reduce((sum, l) => sum + l.line_total_cents, 0);
  const payments = paymentsFor(db, invoice.id);
  const paid = payments.reduce((sum, p) => sum + p.amount_cents, 0);

  return {
    ...invoice,
    lines,
    payments,
    total_cents: total,
    paid_cents: paid,
    balance_cents: total - paid,
    days_overdue: daysOverdue(invoice),
  };
}

const paymentsFor = (db, invoiceId) => db.prepare(
  `SELECT p.*, u.display_name AS recorded_by
     FROM payments p LEFT JOIN users u ON u.id = p.created_by
    WHERE p.invoice_id = ? ORDER BY p.received_on DESC, p.id DESC`,
).all(invoiceId);

/**
 * The status is a fact about the payments, not a field anyone sets. Voiding is
 * the only manual state, so it is the only one preserved here.
 */
export function recomputeStatus(db, invoiceId) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!row || row.status === 'void') return row?.status ?? null;

  const total = db.prepare(
    'SELECT COALESCE(SUM(ROUND(quantity * unit_price_cents)), 0) AS c FROM invoice_lines WHERE invoice_id = ?',
  ).get(invoiceId).c;
  const paid = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) AS c FROM payments WHERE invoice_id = ?',
  ).get(invoiceId).c;

  let status = 'draft';
  if (row.issued_on) {
    if (total > 0 && paid >= total) status = 'paid';
    else if (paid > 0) status = 'partial';
    else status = 'sent';
  }

  if (status !== row.status) db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
  return status;
}

function daysOverdue(invoice) {
  if (!invoice.due_on || ['paid', 'void', 'draft'].includes(invoice.status)) return 0;
  const due = new Date(`${invoice.due_on}T12:00:00Z`);
  const days = Math.floor((Date.now() - due) / 86400000);
  return days > 0 ? days : 0;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function logEvent(db, jobId, note, user) {
  db.prepare("INSERT INTO job_events (job_id, kind, body, author) VALUES (?, 'note', ?, ?)")
    .run(jobId, note, user?.display_name ?? null);
  db.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").run(jobId);
}

const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;
