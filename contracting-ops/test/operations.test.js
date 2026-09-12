import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server.js';
import { signIn } from './helpers.js';

let server;
let base;
let workDir;
let uploadDir;
let cookie;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'contracting-ops3-'));
  ({ server, uploadDir } = createApp({ dbFile: join(workDir, 'test.db'), dataDir: workDir }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn(base, { username: 'mike', display_name: 'Mike', password: 'correct horse battery' });
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

async function upload(path, bytes) {
  const res = await fetch(base + path, {
    method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream' }, body: bytes,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const JPEG = (size = 200) => {
  const buf = Buffer.alloc(size, 0x30);
  buf.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1], 0);
  return buf;
};
const PDF = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]);

const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/* --------------------------------------------------------------------- */

describe('leads', () => {
  test('captures a lead with just a name', async () => {
    const res = await api('POST', '/api/leads', { name: 'Walk-in caller' });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'new');
    assert.equal(res.body.received_on, today());
  });

  test('requires a name and rejects an unknown source', async () => {
    assert.equal((await api('POST', '/api/leads', { phone: '555-0100' })).status, 400);
    assert.equal((await api('POST', '/api/leads', { name: 'X', source: 'billboard' })).status, 400);
  });

  test('moves a lead through contact and loss', async () => {
    const lead = (await api('POST', '/api/leads', { name: 'Priced too high', source: 'web' })).body;
    assert.equal((await api('PATCH', `/api/leads/${lead.id}`, { status: 'contacted' })).body.status, 'contacted');

    const lost = await api('PATCH', `/api/leads/${lead.id}`,
      { status: 'lost', lost_reason: 'Went with a cheaper bid' });
    assert.equal(lost.body.status, 'lost');
    assert.equal(lost.body.lost_reason, 'Went with a cheaper bid');
  });

  test('cannot be marked converted by hand', async () => {
    const lead = (await api('POST', '/api/leads', { name: 'Shortcut' })).body;
    const res = await api('PATCH', `/api/leads/${lead.id}`, { status: 'converted' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /convert/);
  });

  test('converts into a client and a job in one step', async () => {
    const lead = (await api('POST', '/api/leads', {
      name: 'Ellen Kovac', phone: '555-0119', email: 'ek@example.com',
      source: 'referral', description: 'Rear deck is rotting out',
    })).body;

    const res = await api('POST', `/api/leads/${lead.id}/convert`,
      { title: 'Rear deck rebuild', site_address: '2440 Ridge Rd' });
    assert.equal(res.status, 201);
    assert.equal(res.body.lead.status, 'converted');
    assert.equal(res.body.job.title, 'Rear deck rebuild');
    assert.equal(res.body.job.status, 'estimating');
    assert.match(res.body.job.job_number, /^J-\d{4}$/);

    // The client was created from the lead's own contact details.
    const client = await api('GET', `/api/clients/${res.body.client_id}`);
    assert.equal(client.body.name, 'Ellen Kovac');
    assert.equal(client.body.phone, '555-0119');

    // The job's description and opening timeline entry carry the lead over.
    const job = await api('GET', `/api/jobs/${res.body.job.id}`);
    assert.equal(job.body.description, 'Rear deck is rotting out');
    assert.match(job.body.events[0].body, /Converted from lead: Ellen Kovac \(referral\)/);

    assert.equal((await api('POST', `/api/leads/${lead.id}/convert`, {})).status, 400,
      'converting twice must be refused');
  });

  test('converts onto an existing client when one is given', async () => {
    const client = (await api('POST', '/api/clients', { name: 'Ruiz Property Group' })).body;
    const lead = (await api('POST', '/api/leads', { name: 'Ruiz - unit 12' })).body;

    const res = await api('POST', `/api/leads/${lead.id}/convert`, { client_id: client.id, title: 'Unit 12 refresh' });
    assert.equal(res.body.client_id, client.id);
    assert.equal((await api('GET', `/api/clients/${client.id}`)).body.jobs.length, 1);
  });
});

describe('estimates', () => {
  let jobId;

  before(async () => {
    jobId = (await api('POST', '/api/jobs', { title: 'Bathroom gut' })).body.id;
  });

  test('builds an estimate and totals it with markup', async () => {
    const estimate = (await api('POST', `/api/jobs/${jobId}/estimates`, { markup_percent: 15 })).body;
    assert.equal(estimate.version, 1);
    assert.equal(estimate.status, 'draft');

    await api('POST', `/api/estimates/${estimate.id}/lines`,
      { description: 'Demo and haul', quantity: 1, unit: 'ls', unit_cost: '1200' });
    const withLines = (await api('POST', `/api/estimates/${estimate.id}/lines`,
      { description: 'Tile', quantity: 120, unit: 'sf', unit_cost: '8.50' })).body;

    // 1200.00 + (120 x 8.50 = 1020.00) = 2220.00, +15% = 2553.00
    assert.equal(withLines.subtotal_cents, 222000);
    assert.equal(withLines.markup_cents, 33300);
    assert.equal(withLines.total_cents, 255300);
    assert.equal(withLines.lines[1].line_total_cents, 102000);
  });

  test('refuses to send an estimate with no lines', async () => {
    const empty = (await api('POST', `/api/jobs/${jobId}/estimates`, {})).body;
    const res = await api('POST', `/api/estimates/${empty.id}/send`, {});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least one line/);
    await api('DELETE', `/api/estimates/${empty.id}`);
  });

  test('a sent estimate is frozen and moves the job to bid sent', async () => {
    const estimates = (await api('GET', `/api/jobs/${jobId}/estimates`)).body;
    const estimate = estimates.find((e) => e.version === 1);

    const sent = await api('POST', `/api/estimates/${estimate.id}/send`, {});
    assert.equal(sent.status, 200);
    assert.equal(sent.body.status, 'sent');
    assert.ok(sent.body.sent_at);
    assert.equal(sent.body.job_moved_to, 'bid_sent');
    assert.equal(sent.body.editable, false);

    for (const [method, path, body] of [
      ['PATCH', `/api/estimates/${estimate.id}`, { markup_percent: 20 }],
      ['POST', `/api/estimates/${estimate.id}/lines`, { description: 'Sneaky extra', unit_cost: '500' }],
      ['PATCH', `/api/estimate-lines/${estimate.lines[0].id}`, { unit_cost: '99' }],
      ['DELETE', `/api/estimate-lines/${estimate.lines[0].id}`, undefined],
    ]) {
      const res = await api(method, path, body);
      assert.equal(res.status, 400, `${method} ${path} changed a sent estimate`);
      assert.match(res.body.error, /new version/);
    }

    assert.equal((await api('DELETE', `/api/estimates/${estimate.id}`)).status, 400,
      'a sent estimate is a record of what the customer saw');
    assert.equal((await api('POST', `/api/estimates/${estimate.id}/send`, {})).status, 400);
  });

  test('a revision copies the previous version into version 2', async () => {
    const v1 = (await api('GET', `/api/jobs/${jobId}/estimates`)).body.find((e) => e.version === 1);
    const v2 = (await api('POST', `/api/jobs/${jobId}/estimates`,
      { copy_from_estimate_id: v1.id, markup_percent: 12 })).body;

    assert.equal(v2.version, 2);
    assert.equal(v2.status, 'draft');
    assert.equal(v2.lines.length, v1.lines.length);
    assert.equal(v2.subtotal_cents, v1.subtotal_cents);
    assert.equal(v2.markup_cents, Math.round(v1.subtotal_cents * 0.12));
    assert.notEqual(v2.id, v1.id);

    // Editing the new version leaves version 1 exactly as it was sent.
    await api('PATCH', `/api/estimate-lines/${v2.lines[0].id}`, { unit_cost: '1400' });
    const v1After = (await api('GET', `/api/estimates/${v1.id}`)).body;
    assert.equal(v1After.total_cents, 255300);
  });

  test('accepting sets the contract, closes the other versions and schedules the job', async () => {
    const estimates = (await api('GET', `/api/jobs/${jobId}/estimates`)).body;
    const v2 = estimates.find((e) => e.version === 2);
    await api('POST', `/api/estimates/${v2.id}/send`, {});

    const accepted = await api('POST', `/api/estimates/${v2.id}/accept`, {});
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.status, 'accepted');
    assert.equal(accepted.body.job_moved_to, 'scheduled');

    const after = (await api('GET', `/api/jobs/${jobId}/estimates`)).body;
    assert.equal(after.find((e) => e.version === 1).status, 'declined',
      'the superseded version is closed out');

    const budget = await api('GET', `/api/jobs/${jobId}/budget`);
    assert.equal(budget.body.contract_cents, accepted.body.total_cents,
      'the accepted number becomes the contract amount');
  });

  test('an estimate that was never sent cannot be accepted', async () => {
    const job = (await api('POST', '/api/jobs', { title: 'Fence line' })).body;
    const draft = (await api('POST', `/api/jobs/${job.id}/estimates`, {})).body;
    await api('POST', `/api/estimates/${draft.id}/lines`, { description: 'Posts', unit_cost: '400' });
    assert.equal((await api('POST', `/api/estimates/${draft.id}/accept`, {})).status, 400);
  });
});

describe('invoices', () => {
  let jobId;
  let estimateId;

  before(async () => {
    jobId = (await api('POST', '/api/jobs', { title: 'Garage slab' })).body.id;
    const estimate = (await api('POST', `/api/jobs/${jobId}/estimates`, { markup_percent: 10 })).body;
    estimateId = estimate.id;
    await api('POST', `/api/estimates/${estimateId}/lines`,
      { description: 'Concrete', quantity: 12, unit: 'cy', unit_cost: '185' });
    await api('POST', `/api/estimates/${estimateId}/lines`,
      { description: 'Labor', quantity: 24, unit: 'hr', unit_cost: '65' });
    await api('POST', `/api/estimates/${estimateId}/send`, {});
    await api('POST', `/api/estimates/${estimateId}/accept`, {});
  });

  test('builds from the accepted estimate and matches its total exactly', async () => {
    const estimate = (await api('GET', `/api/estimates/${estimateId}`)).body;
    const invoice = (await api('POST', `/api/jobs/${jobId}/invoices`, { from: 'estimate' })).body;

    assert.match(invoice.invoice_number, /^INV-\d{4}$/);
    assert.equal(invoice.status, 'draft');
    assert.equal(invoice.total_cents, estimate.total_cents,
      'the invoice must bill exactly what the customer accepted');
    assert.equal(invoice.lines.at(-1).description, 'Overhead and profit (10%)');
    assert.equal(invoice.lines.at(-1).unit_price_cents, estimate.markup_cents);
  });

  test('refuses to invoice from an estimate when none was accepted', async () => {
    const job = (await api('POST', '/api/jobs', { title: 'Unquoted' })).body;
    const res = await api('POST', `/api/jobs/${job.id}/invoices`, { from: 'estimate' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /no accepted estimate/);
  });

  test('builds from billable actuals, grouped by category', async () => {
    await api('POST', '/api/expenses',
      { job_id: jobId, spent_on: today(), amount: '900', category: 'materials' });
    await api('POST', '/api/expenses',
      { job_id: jobId, spent_on: today(), amount: '150', category: 'fuel', billable: false });

    const invoice = (await api('POST', `/api/jobs/${jobId}/invoices`, { from: 'expenses' })).body;
    assert.equal(invoice.lines.length, 1, 'the non-billable expense must not be billed');
    assert.equal(invoice.total_cents, 90000);
    await api('DELETE', `/api/invoices/${invoice.id}`);
  });

  test('status follows the payments and is never set by hand', async () => {
    const invoice = (await api('GET', `/api/jobs/${jobId}/invoices`)).body[0];
    assert.equal(invoice.status, 'draft');

    assert.equal((await api('PATCH', `/api/invoices/${invoice.id}`, { status: 'paid' })).status, 400);
    assert.equal((await api('POST', `/api/invoices/${invoice.id}/payments`,
      { received_on: today(), amount: '100' })).status, 400, 'cannot pay an unsent invoice');

    const sent = (await api('POST', `/api/invoices/${invoice.id}/send`, { issued_on: today() })).body;
    assert.equal(sent.status, 'sent');
    assert.equal(sent.due_on, daysFromNow(14), 'default terms are 14 days');

    const half = Math.floor(sent.total_cents / 2);
    const partial = (await api('POST', `/api/invoices/${invoice.id}/payments`,
      { received_on: today(), amount: String(half / 100), method: 'check', reference: '1041' })).body;
    assert.equal(partial.status, 'partial');
    assert.equal(partial.paid_cents, half);
    assert.equal(partial.balance_cents, sent.total_cents - half);

    const over = await api('POST', `/api/invoices/${invoice.id}/payments`,
      { received_on: today(), amount: '99999' });
    assert.equal(over.status, 400, 'a payment cannot exceed the balance');

    const paid = (await api('POST', `/api/invoices/${invoice.id}/payments`,
      { received_on: today(), amount: String(partial.balance_cents / 100), method: 'ach' })).body;
    assert.equal(paid.status, 'paid');
    assert.equal(paid.balance_cents, 0);
    assert.equal(paid.payments.length, 2);

    // Removing a payment walks the status back rather than leaving it stale.
    await api('DELETE', `/api/payments/${paid.payments[0].id}`);
    assert.equal((await api('GET', `/api/invoices/${invoice.id}`)).body.status, 'partial');
  });

  test('an invoice with payments cannot be edited, voided or deleted', async () => {
    const invoice = (await api('GET', `/api/jobs/${jobId}/invoices`)).body
      .find((i) => i.paid_cents > 0);

    assert.equal((await api('POST', `/api/invoices/${invoice.id}/lines`,
      { description: 'Extra', unit_price: '100' })).status, 400);
    assert.equal((await api('POST', `/api/invoices/${invoice.id}/void`, {})).status, 400);
    assert.equal((await api('DELETE', `/api/invoices/${invoice.id}`)).status, 400);
  });

  test('an unpaid issued invoice can be voided', async () => {
    const invoice = (await api('POST', `/api/jobs/${jobId}/invoices`, { from: 'empty' })).body;
    await api('POST', `/api/invoices/${invoice.id}/lines`, { description: 'Change order', unit_price: '750' });
    await api('POST', `/api/invoices/${invoice.id}/send`, {});

    const voided = (await api('POST', `/api/invoices/${invoice.id}/void`, {})).body;
    assert.equal(voided.status, 'void');
    assert.equal((await api('POST', `/api/invoices/${invoice.id}/payments`,
      { received_on: today(), amount: '10' })).status, 400);
  });

  test('a job with invoices cannot be deleted', async () => {
    const res = await api('DELETE', `/api/jobs/${jobId}`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /invoice/);
    assert.equal((await api('GET', `/api/jobs/${jobId}`)).status, 200, 'the job must survive the refusal');
  });

  test('lists outstanding and overdue receivables', async () => {
    const job = (await api('POST', '/api/jobs', { title: 'Old work' })).body;
    const invoice = (await api('POST', `/api/jobs/${job.id}/invoices`, { from: 'empty' })).body;
    await api('POST', `/api/invoices/${invoice.id}/lines`, { description: 'Repairs', unit_price: '1800' });
    await api('POST', `/api/invoices/${invoice.id}/send`,
      { issued_on: daysFromNow(-60), due_on: daysFromNow(-46) });

    const overdue = await api('GET', '/api/invoices?status=overdue');
    const row = overdue.body.invoices.find((i) => i.id === invoice.id);
    assert.ok(row, 'the aged invoice should appear in the overdue list');
    assert.ok(row.days_overdue >= 45);

    const outstanding = await api('GET', '/api/invoices?status=outstanding');
    assert.ok(outstanding.body.totals.outstanding_cents >= 180000);
  });
});

describe('job photos', () => {
  let jobId;

  before(async () => {
    jobId = (await api('POST', '/api/jobs', { title: 'Photo job' })).body.id;
  });

  test('uploads a photo with a stage and a caption', async () => {
    const res = await upload(
      `/api/jobs/${jobId}/photos?stage=before&caption=${encodeURIComponent('Old vanity, water damage')}`,
      JPEG(500),
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.stage, 'before');
    assert.equal(res.body.caption, 'Old vanity, water damage');
    assert.equal(res.body.mime_type, 'image/jpeg');
    assert.ok(readdirSync(uploadDir).includes(res.body.stored_name));
  });

  test('groups photos by stage and filters', async () => {
    await upload(`/api/jobs/${jobId}/photos?stage=after&caption=Finished`, JPEG(400));
    const all = await api('GET', `/api/jobs/${jobId}/photos`);
    assert.equal(all.body.photos.length, 2);
    assert.equal(all.body.counts.before, 1);
    assert.equal(all.body.counts.after, 1);

    const before = await api('GET', `/api/jobs/${jobId}/photos?stage=before`);
    assert.equal(before.body.photos.length, 1);
    assert.equal((await api('GET', `/api/jobs/${jobId}/photos?stage=sideways`)).status, 400);
  });

  test('refuses a PDF and leaves nothing behind', async () => {
    const before = readdirSync(uploadDir).length;
    const res = await upload(`/api/jobs/${jobId}/photos`, PDF());
    assert.equal(res.status, 400);
    assert.match(res.body.error, /images, not PDFs/);
    assert.equal(readdirSync(uploadDir).length, before, 'the rejected file must not stay on disk');
  });

  test('re-stages a photo and deletes it from disk', async () => {
    const photo = (await api('GET', `/api/jobs/${jobId}/photos`)).body.photos[0];
    const moved = await api('PATCH', `/api/photos/${photo.id}`, { stage: 'issue', caption: 'Rot under the sill' });
    assert.equal(moved.body.stage, 'issue');
    assert.equal(moved.body.caption, 'Rot under the sill');

    const before = readdirSync(uploadDir).length;
    assert.equal((await api('DELETE', `/api/photos/${photo.id}`)).status, 200);
    assert.equal(readdirSync(uploadDir).length, before - 1);
  });

  test('a receipt is not reachable through the photo routes', async () => {
    const expense = (await api('POST', '/api/expenses',
      { spent_on: today(), amount: '20', category: 'fuel' })).body;
    const receipt = (await upload(`/api/expenses/${expense.id}/receipt`, JPEG(300))).body;
    assert.equal((await api('PATCH', `/api/photos/${receipt.id}`, { stage: 'after' })).status, 404);
    assert.equal((await api('DELETE', `/api/photos/${receipt.id}`)).status, 404);
  });
});

describe('executive report', () => {
  test('answers the four questions about the business', async () => {
    const res = await api('GET', '/api/reports/executive');
    assert.equal(res.status, 200);
    const { leads, estimates, backlog, receivables, completed_jobs: completed } = res.body;

    assert.ok(leads.converted >= 2);
    assert.ok(leads.lost >= 1);
    assert.equal(leads.win_rate_percent,
      Math.round((leads.converted / (leads.converted + leads.lost)) * 1000) / 10);
    assert.ok(leads.by_source.some((s) => s.source === 'referral' && s.converted >= 1));

    assert.ok(estimates.accepted_count >= 2);
    assert.ok(estimates.won_cents > 0);
    assert.equal(estimates.win_rate_percent,
      Math.round((estimates.accepted_count / (estimates.accepted_count + estimates.declined_count)) * 1000) / 10);

    assert.ok(backlog.job_count >= 1);
    assert.equal(backlog.expected_margin_cents, backlog.contract_cents - backlog.spent_cents);

    assert.ok(receivables.outstanding_cents > 0);
    assert.equal(
      receivables.aging.reduce((n, b) => n + b.cents, 0),
      receivables.outstanding_cents,
      'the aging buckets must account for every outstanding cent',
    );
    assert.ok(Array.isArray(completed));
  });
});
