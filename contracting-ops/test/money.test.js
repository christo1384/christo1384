import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server.js';
import { parseMoneyToCents } from '../src/lib/money.js';
import { signIn } from './helpers.js';

let server;
let base;
let workDir;
let uploadDir;
let cookie;
let jobId;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'contracting-money-'));
  ({ server, uploadDir } = createApp({ dbFile: join(workDir, 'test.db'), dataDir: workDir }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn(base, { username: 'mike', display_name: 'Mike', password: 'correct horse battery' });

  const job = await api('POST', '/api/jobs', { title: 'Kitchen remodel' });
  jobId = job.body.id;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
});

async function api(method, path, body, withCookie = cookie) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(withCookie ? { cookie: withCookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function upload(path, bytes, contentType = 'application/octet-stream') {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { cookie, 'content-type': contentType },
    body: bytes,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const JPEG = (size = 64) => {
  const buf = Buffer.alloc(size, 0x20);
  buf.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1], 0);
  return buf;
};

/* --------------------------------------------------------------------- */

describe('money parsing', () => {
  test('converts dollar input to whole cents without floating point', () => {
    assert.equal(parseMoneyToCents('1250.75', 'amount'), 125075);
    assert.equal(parseMoneyToCents('$1,250.75', 'amount'), 125075);
    assert.equal(parseMoneyToCents('1250', 'amount'), 125000);
    assert.equal(parseMoneyToCents('0.1', 'amount'), 10);
    assert.equal(parseMoneyToCents('-42.50', 'amount'), -4250);
    assert.equal(parseMoneyToCents(19.99, 'amount'), 1999);
    assert.equal(parseMoneyToCents('', 'amount'), null);
    // A stray space from a phone keyboard is unambiguous, so it is tolerated.
    assert.equal(parseMoneyToCents('1 250', 'amount'), 125000);
  });

  test('the classic float trap lands exactly', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in cents it is just 30.
    assert.equal(parseMoneyToCents('0.1', 'a') + parseMoneyToCents('0.2', 'a'), 30);
  });

  test('rejects anything that is not an amount', () => {
    // '12,' and '1,2,3' matter: stripping separators before validating would
    // silently turn a typo into a number nobody typed.
    for (const bad of ['abc', '12.345', '1.2.3', '12,', '1,2,3', '1,25', '--5']) {
      assert.throws(() => parseMoneyToCents(bad, 'amount'), /must be an amount/, `accepted ${bad}`);
    }
  });
});

describe('authentication', () => {
  test('refuses every data route without a session', async () => {
    for (const [method, path] of [
      ['GET', '/api/jobs'], ['GET', '/api/expenses'], ['GET', '/api/dashboard'],
      ['GET', '/api/reports/spend'], ['POST', '/api/expenses'],
    ]) {
      const res = await api(method, path, undefined, null);
      assert.equal(res.status, 401, `${method} ${path} was reachable without signing in`);
    }
  });

  test('health and auth status stay public so the box can be checked', async () => {
    assert.equal((await api('GET', '/api/health', undefined, null)).status, 200);
    const status = await api('GET', '/api/auth/status', undefined, null);
    assert.equal(status.status, 200);
    assert.equal(status.body.needs_setup, false);
  });

  test('first-run setup closes once an account exists', async () => {
    const res = await api('POST', '/api/auth/setup',
      { username: 'sneak', display_name: 'Sneak', password: 'another long one' }, null);
    assert.equal(res.status, 409);
  });

  test('rejects a wrong password and accepts the right one', async () => {
    assert.equal((await api('POST', '/api/auth/login', { username: 'mike', password: 'wrong' }, null)).status, 401);
    assert.equal((await api('POST', '/api/auth/login',
      { username: 'mike', password: 'correct horse battery' }, null)).status, 200);
  });

  test('refuses a short password on a new account', async () => {
    const res = await api('POST', '/api/users', { username: 'kim', display_name: 'Kim', password: 'short' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least 10/);
  });

  test('stores no plaintext password and no raw session token', async () => {
    const { openDb } = await import('../src/db.js');
    const db = openDb(join(workDir, 'test.db'));
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('mike');
    assert.ok(!JSON.stringify(user).includes('correct horse battery'));
    assert.equal(user.password_hash.length, 128);

    const token = cookie.split('=')[1];
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0);
    db.close();
  });
});

describe('expenses', () => {
  test('records an expense in cents and attributes it to the signed-in user', async () => {
    const res = await api('POST', '/api/expenses', {
      job_id: jobId, spent_on: '2026-09-02', amount: '1,240.55', category: 'materials',
      payment_method: 'card', description: 'Cabinet hardware',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.amount_cents, 124055);
    assert.equal(res.body.created_by_name, 'Mike');
    assert.equal(res.body.billable, true);
  });

  test('requires a date, an amount and a category', async () => {
    assert.equal((await api('POST', '/api/expenses', { amount: '10', category: 'fuel' })).status, 400);
    assert.equal((await api('POST', '/api/expenses', { spent_on: '2026-09-02', category: 'fuel' })).status, 400);
    assert.equal((await api('POST', '/api/expenses', { spent_on: '2026-09-02', amount: '10' })).status, 400);
  });

  test('rejects an unknown category and a bad amount', async () => {
    assert.equal((await api('POST', '/api/expenses',
      { spent_on: '2026-09-02', amount: '10', category: 'beer' })).status, 400);
    assert.equal((await api('POST', '/api/expenses',
      { spent_on: '2026-09-02', amount: 'twenty', category: 'fuel' })).status, 400);
  });

  test('allows an expense with no job as overhead', async () => {
    const res = await api('POST', '/api/expenses', {
      spent_on: '2026-09-03', amount: '89.00', category: 'other', description: 'Liability insurance',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.job_id, null);

    const overhead = await api('GET', '/api/expenses?overhead=1');
    assert.ok(overhead.body.expenses.every((e) => e.job_id === null));
  });

  test('rejects a job or vendor that does not exist', async () => {
    assert.equal((await api('POST', '/api/expenses',
      { job_id: 9999, spent_on: '2026-09-02', amount: '10', category: 'fuel' })).status, 400);
    assert.equal((await api('POST', '/api/expenses',
      { vendor_id: 9999, spent_on: '2026-09-02', amount: '10', category: 'fuel' })).status, 400);
  });

  test('links an expense to a vendor and rolls up the vendor total', async () => {
    const vendor = await api('POST', '/api/vendors', { name: 'Buildright Lumber', category: 'lumber' });
    assert.equal(vendor.status, 201);
    assert.equal((await api('POST', '/api/vendors', { name: 'buildright lumber' })).status, 400);

    await api('POST', '/api/expenses', {
      job_id: jobId, vendor_id: vendor.body.id, spent_on: '2026-09-04', amount: '300.00', category: 'materials',
    });
    const vendors = await api('GET', '/api/vendors');
    const row = vendors.body.find((v) => v.id === vendor.body.id);
    assert.equal(row.total_cents, 30000);
    assert.equal(row.expense_count, 1);
  });

  test('edits and deletes an expense', async () => {
    const created = await api('POST', '/api/expenses', {
      spent_on: '2026-09-05', amount: '50.00', category: 'fuel',
    });
    const patched = await api('PATCH', `/api/expenses/${created.body.id}`, { amount: '61.20', billable: false });
    assert.equal(patched.body.amount_cents, 6120);
    assert.equal(patched.body.billable, false);

    assert.equal((await api('DELETE', `/api/expenses/${created.body.id}`)).status, 200);
    assert.equal((await api('GET', `/api/expenses/${created.body.id}`)).status, 404);
  });

  test('filters by category and date range', async () => {
    const byCategory = await api('GET', '/api/expenses?category=materials');
    assert.ok(byCategory.body.expenses.every((e) => e.category === 'materials'));
    assert.equal((await api('GET', '/api/expenses?category=nonsense')).status, 400);

    const ranged = await api('GET', '/api/expenses?from=2026-09-03&to=2026-09-04');
    assert.ok(ranged.body.expenses.every((e) => e.spent_on >= '2026-09-03' && e.spent_on <= '2026-09-04'));
  });
});

describe('receipts', () => {
  let expenseId;

  before(async () => {
    const res = await api('POST', '/api/expenses', { spent_on: '2026-09-06', amount: '12.00', category: 'fuel' });
    expenseId = res.body.id;
  });

  test('stores an uploaded JPEG under a generated name', async () => {
    const res = await upload(`/api/expenses/${expenseId}/receipt?filename=../../etc/passwd`, JPEG(400), 'image/jpeg');
    assert.equal(res.status, 201);
    assert.equal(res.body.mime_type, 'image/jpeg');
    assert.equal(res.body.byte_size, 400);
    assert.match(res.body.stored_name, /^[a-z0-9]+-[a-f0-9]{16}\.jpg$/);

    const stored = readdirSync(uploadDir);
    assert.ok(stored.includes(res.body.stored_name));
    assert.ok(!stored.some((f) => f.includes('passwd')), 'a client filename must never reach the disk');
  });

  test('the receipt comes back on the expense and streams with its real type', async () => {
    const expense = await api('GET', `/api/expenses/${expenseId}`);
    assert.equal(expense.body.receipts.length, 1);

    const res = await fetch(`${base}/api/attachments/${expense.body.receipts[0].id}`, { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

    const anonymous = await fetch(`${base}/api/attachments/${expense.body.receipts[0].id}`);
    assert.equal(anonymous.status, 401, 'receipts must not be readable without a session');
  });

  test('refuses a file whose bytes are not an image or PDF', async () => {
    const res = await upload(`/api/expenses/${expenseId}/receipt`,
      Buffer.from('<?php system($_GET["c"]); ?> padding padding padding'), 'image/jpeg');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not accepted/);
  });

  test('refuses a file over the size cap', async () => {
    const res = await upload(`/api/expenses/${expenseId}/receipt`, JPEG(13 * 1024 * 1024), 'image/jpeg');
    assert.equal(res.status, 413);
  });

  test('deleting the expense removes its receipt from disk', async () => {
    const expense = await api('GET', `/api/expenses/${expenseId}`);
    const stored = expense.body.receipts.map((r) => r.id);
    assert.ok(stored.length > 0);

    const before = readdirSync(uploadDir).length;
    await api('DELETE', `/api/expenses/${expenseId}`);
    assert.equal(readdirSync(uploadDir).length, before - stored.length);
    assert.equal((await api('GET', `/api/attachments/${stored[0]}`)).status, 404);
  });
});

describe('budgets and job costing', () => {
  test('starts with an empty budget rather than a 404', async () => {
    const res = await api('GET', `/api/jobs/${jobId}/budget`);
    assert.equal(res.status, 200);
    assert.equal(res.body.contract_cents, null);
  });

  test('saves a budget and computes margin against actual spend', async () => {
    await api('PUT', `/api/jobs/${jobId}/budget`, {
      contract: '20000', materials_budget: '9000', labor_budget: '6000', other_budget: '1000',
    });

    const costs = await api('GET', `/api/jobs/${jobId}/costs`);
    assert.equal(costs.status, 200);
    assert.equal(costs.body.contract_cents, 2000000);

    // Seeded above: 1240.55 + 300.00 materials.
    const spent = costs.body.spent_cents;
    assert.equal(spent, 124055 + 30000);
    assert.equal(costs.body.margin_cents, 2000000 - spent);
    assert.equal(costs.body.remaining_cents, 2000000 - spent);
    assert.ok(costs.body.margin_percent > 0);

    const materials = costs.body.budget_vs_actual.find((l) => l.line === 'materials');
    assert.equal(materials.budget_cents, 900000);
    assert.equal(materials.spent_cents, spent);
  });

  test('counts subcontractor spend against the labor line', async () => {
    const job = (await api('POST', '/api/jobs', { title: 'Deck rebuild' })).body;
    await api('PUT', `/api/jobs/${job.id}/budget`, { contract: '5000', labor_budget: '2000' });
    await api('POST', '/api/expenses',
      { job_id: job.id, spent_on: '2026-09-07', amount: '800', category: 'labor' });
    await api('POST', '/api/expenses',
      { job_id: job.id, spent_on: '2026-09-07', amount: '1500', category: 'subcontractor' });

    const costs = await api('GET', `/api/jobs/${job.id}/costs`);
    const labor = costs.body.budget_vs_actual.find((l) => l.line === 'labor');
    assert.equal(labor.spent_cents, 230000);
    assert.ok(labor.spent_cents > labor.budget_cents, 'this job is over on labor');
    assert.equal(costs.body.margin_cents, 500000 - 230000);
  });

  test('leaves margin null when no contract amount is set', async () => {
    const job = (await api('POST', '/api/jobs', { title: 'Unpriced job' })).body;
    await api('POST', '/api/expenses',
      { job_id: job.id, spent_on: '2026-09-08', amount: '75', category: 'permit' });

    const costs = await api('GET', `/api/jobs/${job.id}/costs`);
    assert.equal(costs.body.contract_cents, null);
    assert.equal(costs.body.margin_cents, null);
    assert.equal(costs.body.margin_percent, null);
    assert.equal(costs.body.spent_cents, 7500);
  });

  test('an expense survives its job being deleted, as overhead', async () => {
    const job = (await api('POST', '/api/jobs', { title: 'Doomed job' })).body;
    const expense = (await api('POST', '/api/expenses',
      { job_id: job.id, spent_on: '2026-09-09', amount: '33', category: 'rental' })).body;

    await api('DELETE', `/api/jobs/${job.id}`);
    const after = await api('GET', `/api/expenses/${expense.id}`);
    assert.equal(after.status, 200, 'financial records must outlive the job record');
    assert.equal(after.body.job_id, null);
  });
});

describe('spend reports', () => {
  test('rolls up by month, category, vendor and job', async () => {
    const res = await api('GET', '/api/reports/spend');
    assert.equal(res.status, 200);

    const summed = res.body.by_category.reduce((n, r) => n + r.cents, 0);
    assert.equal(summed, res.body.total_cents, 'category rollup must equal the total');
    assert.equal(
      res.body.by_month.reduce((n, r) => n + r.cents, 0),
      res.body.total_cents,
      'month rollup must equal the total',
    );

    assert.ok(res.body.by_vendor.some((v) => v.vendor === 'Buildright Lumber'));
    assert.ok(res.body.by_job.length > 0);
    assert.ok(res.body.overhead_cents > 0);
  });

  test('honours a date range', async () => {
    const res = await api('GET', '/api/reports/spend?from=2026-09-07&to=2026-09-09');
    assert.ok(res.body.total_cents > 0);
    assert.ok(res.body.by_month.every((m) => m.month === '2026-09'));

    const empty = await api('GET', '/api/reports/spend?from=2030-01-01');
    assert.equal(empty.body.total_cents, 0);
    assert.equal(empty.body.by_category.length, 0);
  });
});

describe('optional selects', () => {
  test('an empty "paid with" is stored as unset, not rejected', async () => {
    const res = await api('POST', '/api/expenses', {
      spent_on: '2026-09-10', amount: '25', category: 'fuel', payment_method: '', vendor_id: '', tax: '',
    });
    assert.equal(res.status, 201, res.body.error);
    assert.equal(res.body.payment_method, null);
    assert.equal(res.body.vendor_id, null);
    assert.equal(res.body.tax_cents, 0);
  });

  test('an empty category is still refused', async () => {
    const created = await api('POST', '/api/expenses',
      { spent_on: '2026-09-10', amount: '25', category: 'fuel' });
    const res = await api('PATCH', `/api/expenses/${created.body.id}`, { category: '' });
    assert.equal(res.status, 400);
  });

  test('an empty status on a job move is refused', async () => {
    const job = (await api('POST', '/api/jobs', { title: 'Status check' })).body;
    assert.equal((await api('POST', `/api/jobs/${job.id}/status`, { status: '' })).status, 400);
  });
});

describe('data at rest', () => {
  test('the database and its directory are owner-only', async () => {
    // The box may be shared with other services. A world-readable database
    // would hand any local account the books, the client list and the
    // password hashes.
    const { statSync } = await import('node:fs');
    const mode = (path) => statSync(path).mode & 0o777;

    assert.equal(mode(join(workDir, 'test.db')).toString(8), '600');
    assert.equal(mode(workDir).toString(8), '700');

    for (const sidecar of ['test.db-wal', 'test.db-shm']) {
      const path = join(workDir, sidecar);
      if (existsSync(path)) {
        assert.equal(mode(path).toString(8), '600', `${sidecar} is readable by others`);
      }
    }
  });

  test('uploaded receipts are owner-only in an owner-only directory', async () => {
    const { statSync } = await import('node:fs');
    // Upload here rather than relying on a file an earlier block may have
    // already deleted.
    const expense = await api('POST', '/api/expenses',
      { spent_on: '2026-09-11', amount: '15', category: 'fuel' });
    const receipt = await upload(`/api/expenses/${expense.body.id}/receipt`, JPEG(320));
    assert.equal(receipt.status, 201);

    assert.equal((statSync(uploadDir).mode & 0o777).toString(8), '700');
    assert.equal(
      (statSync(join(uploadDir, receipt.body.stored_name)).mode & 0o777).toString(8), '600',
      'a receipt image must not be readable by other accounts on the box',
    );
  });
});
