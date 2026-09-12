import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { sendJson, readJson, notFound, badRequest } from '../lib/http.js';
import {
  requiredText, optionalText, optionalEnum, requiredEnum, requiredDate, optionalDate,
  optionalId, optionalBool, pathId, buildPatch,
} from '../lib/validate.js';
import { requiredCents, optionalCents } from '../lib/money.js';
import { storeUpload, removeUpload, MAX_UPLOAD_BYTES } from '../lib/uploads.js';

export const EXPENSE_CATEGORIES = ['materials', 'labor', 'subcontractor', 'permit', 'rental', 'fuel', 'other'];
export const PAYMENT_METHODS = ['card', 'check', 'cash', 'ach'];

export function registerExpenseRoutes(router, db, { uploadDir }) {
  /* ------------------------------ vendors ------------------------------ */

  router.get('/api/vendors', (req, res) => {
    sendJson(res, 200, db.prepare(
      `SELECT v.*, COUNT(e.id) AS expense_count, COALESCE(SUM(e.amount_cents), 0) AS total_cents
         FROM vendors v LEFT JOIN expenses e ON e.vendor_id = v.id
        GROUP BY v.id ORDER BY v.name COLLATE NOCASE`,
    ).all());
  });

  router.post('/api/vendors', async (req, res) => {
    const body = await readJson(req);
    const name = requiredText(body, 'name', { max: 200 });
    if (db.prepare('SELECT 1 FROM vendors WHERE name = ?').get(name)) {
      throw badRequest('A vendor with that name already exists');
    }
    const info = db.prepare(
      'INSERT INTO vendors (name, category, account_number, notes) VALUES (?, ?, ?, ?)',
    ).run(
      name,
      optionalText(body, 'category', { max: 100 }) ?? null,
      optionalText(body, 'account_number', { max: 100 }) ?? null,
      optionalText(body, 'notes') ?? null,
    );
    sendJson(res, 201, db.prepare('SELECT * FROM vendors WHERE id = ?').get(Number(info.lastInsertRowid)));
  });

  /* ----------------------------- expenses ----------------------------- */

  router.get('/api/expenses', (req, res, { query }) => {
    const where = [];
    const args = {};

    if (query.get('job_id')) { where.push('e.job_id = :job_id'); args.job_id = Number(query.get('job_id')); }
    if (query.get('overhead') === '1') where.push('e.job_id IS NULL');
    if (query.get('vendor_id')) { where.push('e.vendor_id = :vendor_id'); args.vendor_id = Number(query.get('vendor_id')); }

    const category = query.get('category');
    if (category) {
      if (!EXPENSE_CATEGORIES.includes(category)) throw badRequest(`Unknown category: ${category}`);
      where.push('e.category = :category');
      args.category = category;
    }
    const from = query.get('from');
    const to = query.get('to');
    if (from) { where.push('e.spent_on >= :from'); args.from = from; }
    if (to) { where.push('e.spent_on <= :to'); args.to = to; }

    const rows = db.prepare(
      `${selectExpense} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY e.spent_on DESC, e.id DESC
        LIMIT ${Math.min(Number(query.get('limit')) || 200, 500)}`,
    ).all(args);

    const totals = rows.reduce((acc, r) => ({
      count: acc.count + 1,
      total_cents: acc.total_cents + r.amount_cents,
    }), { count: 0, total_cents: 0 });

    sendJson(res, 200, { totals, expenses: rows.map(withReceipts(db)) });
  });

  router.post('/api/expenses', async (req, res, { user }) => {
    const body = await readJson(req);
    const jobId = optionalId(body, 'job_id') ?? null;
    if (jobId && !db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) {
      throw badRequest('job_id does not match a job');
    }
    const vendorId = optionalId(body, 'vendor_id') ?? null;
    if (vendorId && !db.prepare('SELECT 1 FROM vendors WHERE id = ?').get(vendorId)) {
      throw badRequest('vendor_id does not match a vendor');
    }
    const campaignId = optionalId(body, 'campaign_id') ?? null;
    if (campaignId && !db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId)) {
      throw badRequest('campaign_id does not match a campaign');
    }

    const info = db.prepare(
      `INSERT INTO expenses
         (job_id, vendor_id, campaign_id, spent_on, amount_cents, tax_cents, category, payment_method, description, billable, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      jobId, vendorId, campaignId,
      requiredDate(body, 'spent_on'),
      requiredCents(body, 'amount'),
      optionalCents(body, 'tax') ?? 0,
      requiredEnum(body, 'category', EXPENSE_CATEGORIES),
      optionalEnum(body, 'payment_method', PAYMENT_METHODS) ?? null,
      optionalText(body, 'description', { max: 500 }) ?? null,
      optionalBool(body, 'billable') ?? 1,
      user?.id ?? null,
    );
    sendJson(res, 201, getExpense(db, Number(info.lastInsertRowid)));
  });

  router.get('/api/expenses/:id', (req, res, { params }) => {
    const expense = getExpense(db, pathId(params));
    if (!expense) throw notFound('Expense not found');
    sendJson(res, 200, expense);
  });

  router.patch('/api/expenses/:id', async (req, res, { params }) => {
    const id = pathId(params);
    if (!getExpense(db, id)) throw notFound('Expense not found');
    const body = await readJson(req);

    const jobId = optionalId(body, 'job_id');
    if (jobId && !db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) {
      throw badRequest('job_id does not match a job');
    }
    const vendorId = optionalId(body, 'vendor_id');
    if (vendorId && !db.prepare('SELECT 1 FROM vendors WHERE id = ?').get(vendorId)) {
      throw badRequest('vendor_id does not match a vendor');
    }

    const { columns, values } = buildPatch({
      job_id: jobId,
      vendor_id: vendorId,
      spent_on: optionalDate(body, 'spent_on'),
      amount_cents: optionalCents(body, 'amount'),
      tax_cents: optionalCents(body, 'tax'),
      category: 'category' in body ? requiredEnum(body, 'category', EXPENSE_CATEGORIES) : undefined,
      payment_method: optionalEnum(body, 'payment_method', PAYMENT_METHODS),
      description: optionalText(body, 'description', { max: 500 }),
      billable: optionalBool(body, 'billable'),
      campaign_id: optionalId(body, 'campaign_id'),
    });

    if (columns.length) {
      db.prepare(`UPDATE expenses SET ${columns.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, id);
    }
    sendJson(res, 200, getExpense(db, id));
  });

  router.delete('/api/expenses/:id', (req, res, { params }) => {
    const id = pathId(params);
    if (!getExpense(db, id)) throw notFound('Expense not found');
    for (const a of receiptsFor(db, id)) removeUpload(uploadDir, a.stored_name);
    db.prepare("DELETE FROM attachments WHERE owner_type = 'expense' AND owner_id = ?").run(id);
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    sendJson(res, 200, { deleted: id });
  });

  /* ---------------------------- attachments ---------------------------- */

  router.post('/api/expenses/:id/receipt', async (req, res, { params, user, query }) => {
    const id = pathId(params);
    if (!getExpense(db, id)) throw notFound('Expense not found');

    const file = await storeUpload(req, uploadDir);
    const info = db.prepare(
      `INSERT INTO attachments (owner_type, owner_id, stored_name, original_name, mime_type, byte_size, created_by)
       VALUES ('expense', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, file.storedName,
      (query.get('filename') ?? '').slice(0, 200) || null,
      file.mimeType, file.byteSize, user?.id ?? null,
    );
    sendJson(res, 201, db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(info.lastInsertRowid)));
  });

  router.get('/api/attachments/:id', (req, res, { params }) => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(pathId(params));
    if (!row) throw notFound('Attachment not found');
    res.writeHead(200, {
      'content-type': row.mime_type,
      'content-length': row.byte_size,
      'cache-control': 'private, max-age=86400',
      'content-disposition': `inline; filename="receipt-${row.id}"`,
      'x-content-type-options': 'nosniff',
    });
    createReadStream(join(uploadDir, row.stored_name)).pipe(res);
  });

  router.delete('/api/attachments/:id', (req, res, { params }) => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(pathId(params));
    if (!row) throw notFound('Attachment not found');
    removeUpload(uploadDir, row.stored_name);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
    sendJson(res, 200, { deleted: row.id });
  });

  router.get('/api/uploads/limits', (req, res) => sendJson(res, 200, { max_bytes: MAX_UPLOAD_BYTES }));

  /* ------------------------- budgets and costing ------------------------ */

  router.get('/api/jobs/:id/budget', (req, res, { params }) => {
    const id = pathId(params);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) throw notFound('Job not found');
    sendJson(res, 200, budgetFor(db, id));
  });

  router.put('/api/jobs/:id/budget', async (req, res, { params }) => {
    const id = pathId(params);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) throw notFound('Job not found');
    const body = await readJson(req);

    const values = {
      contract_cents: optionalCents(body, 'contract') ?? null,
      materials_budget_cents: optionalCents(body, 'materials_budget') ?? null,
      labor_budget_cents: optionalCents(body, 'labor_budget') ?? null,
      other_budget_cents: optionalCents(body, 'other_budget') ?? null,
    };
    db.prepare(
      `INSERT INTO job_budgets (job_id, contract_cents, materials_budget_cents, labor_budget_cents, other_budget_cents)
       VALUES (:job_id, :contract_cents, :materials_budget_cents, :labor_budget_cents, :other_budget_cents)
       ON CONFLICT(job_id) DO UPDATE SET
         contract_cents = excluded.contract_cents,
         materials_budget_cents = excluded.materials_budget_cents,
         labor_budget_cents = excluded.labor_budget_cents,
         other_budget_cents = excluded.other_budget_cents,
         updated_at = datetime('now')`,
    ).run({ job_id: id, ...values });

    sendJson(res, 200, budgetFor(db, id));
  });

  router.get('/api/jobs/:id/costs', (req, res, { params }) => {
    const id = pathId(params);
    const job = db.prepare('SELECT id, job_number, title, status FROM jobs WHERE id = ?').get(id);
    if (!job) throw notFound('Job not found');

    const budget = budgetFor(db, id);
    const byCategory = db.prepare(
      `SELECT category, SUM(amount_cents) AS cents, COUNT(*) AS count
         FROM expenses WHERE job_id = ? GROUP BY category ORDER BY cents DESC`,
    ).all(id);

    const spentCents = byCategory.reduce((sum, r) => sum + r.cents, 0);
    const contract = budget.contract_cents;
    const spentByCategory = new Map(byCategory.map((r) => [r.category, r.cents]));

    // Labor and subcontractor both count against the labor budget line.
    const laborSpent = (spentByCategory.get('labor') ?? 0) + (spentByCategory.get('subcontractor') ?? 0);
    const materialsSpent = spentByCategory.get('materials') ?? 0;
    const otherSpent = spentCents - laborSpent - materialsSpent;

    sendJson(res, 200, {
      job,
      contract_cents: contract,
      spent_cents: spentCents,
      remaining_cents: contract === null ? null : contract - spentCents,
      margin_cents: contract === null ? null : contract - spentCents,
      margin_percent: contract ? Math.round(((contract - spentCents) / contract) * 1000) / 10 : null,
      by_category: byCategory,
      budget_vs_actual: [
        { line: 'materials', budget_cents: budget.materials_budget_cents, spent_cents: materialsSpent },
        { line: 'labor', budget_cents: budget.labor_budget_cents, spent_cents: laborSpent },
        { line: 'other', budget_cents: budget.other_budget_cents, spent_cents: otherSpent },
      ],
      expenses: db.prepare(`${selectExpense} WHERE e.job_id = ? ORDER BY e.spent_on DESC, e.id DESC`)
        .all(id).map(withReceipts(db)),
    });
  });

  /* ------------------------------ reports ------------------------------ */

  router.get('/api/reports/spend', (req, res, { query }) => {
    const from = query.get('from') ?? null;
    const to = query.get('to') ?? null;
    const range = [];
    const args = {};
    if (from) { range.push('spent_on >= :from'); args.from = from; }
    if (to) { range.push('spent_on <= :to'); args.to = to; }
    const filter = range.length ? `WHERE ${range.join(' AND ')}` : '';

    const rollup = (sql) => db.prepare(sql).all(args);

    sendJson(res, 200, {
      range: { from, to },
      total_cents: db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenses ${filter}`).get(args).c,
      by_month: rollup(
        `SELECT substr(spent_on, 1, 7) AS month, SUM(amount_cents) AS cents, COUNT(*) AS count
           FROM expenses ${filter} GROUP BY month ORDER BY month DESC LIMIT 24`),
      by_category: rollup(
        `SELECT category, SUM(amount_cents) AS cents, COUNT(*) AS count
           FROM expenses ${filter} GROUP BY category ORDER BY cents DESC`),
      by_vendor: rollup(
        `SELECT COALESCE(v.name, 'No vendor') AS vendor, SUM(e.amount_cents) AS cents, COUNT(*) AS count
           FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id
           ${filter.replace(/spent_on/g, 'e.spent_on')}
          GROUP BY e.vendor_id ORDER BY cents DESC LIMIT 20`),
      by_job: rollup(
        `SELECT j.id AS job_id, j.job_number, j.title, SUM(e.amount_cents) AS cents, COUNT(*) AS count
           FROM expenses e JOIN jobs j ON j.id = e.job_id
           ${filter.replace(/spent_on/g, 'e.spent_on')}
          GROUP BY j.id ORDER BY cents DESC LIMIT 20`),
      overhead_cents: db.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenses
          ${filter ? `${filter} AND` : 'WHERE'} job_id IS NULL`).get(args).c,
    });
  });
}

/* ------------------------------ helpers ------------------------------ */

const selectExpense = `
  SELECT e.*, v.name AS vendor_name, j.job_number, j.title AS job_title,
         u.display_name AS created_by_name, cm.name AS campaign_name
    FROM expenses e
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN jobs j ON j.id = e.job_id
    LEFT JOIN users u ON u.id = e.created_by
    LEFT JOIN campaigns cm ON cm.id = e.campaign_id`;

function getExpense(db, id) {
  const row = db.prepare(`${selectExpense} WHERE e.id = ?`).get(id);
  return row ? withReceipts(db)(row) : null;
}

const receiptsFor = (db, expenseId) => db.prepare(
  "SELECT * FROM attachments WHERE owner_type = 'expense' AND owner_id = ? ORDER BY id",
).all(expenseId);

const withReceipts = (db) => (row) => ({
  ...row,
  billable: Boolean(row.billable),
  receipts: receiptsFor(db, row.id).map((a) => ({
    id: a.id, mime_type: a.mime_type, byte_size: a.byte_size, created_at: a.created_at,
  })),
});

function budgetFor(db, jobId) {
  return db.prepare('SELECT * FROM job_budgets WHERE job_id = ?').get(jobId) ?? {
    job_id: jobId,
    contract_cents: null,
    materials_budget_cents: null,
    labor_budget_cents: null,
    other_budget_cents: null,
    updated_at: null,
  };
}
