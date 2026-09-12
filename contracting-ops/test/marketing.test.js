import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server.js';
import { signIn } from './helpers.js';

let server;
let base;
let workDir;
let cookie;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'contracting-ops4-'));
  ({ server } = createApp({ dbFile: join(workDir, 'test.db'), dataDir: workDir }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn(base, { username: 'mike', display_name: 'Mike', password: 'correct horse battery' });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
});

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const today = () => new Date().toISOString().slice(0, 10);

/** Lead -> job -> accepted contract, so a campaign has something to attribute. */
async function winWork({ campaignId, referrerId, contract, name }) {
  const lead = (await api('POST', '/api/leads', {
    name, source: campaignId ? 'sign' : 'referral',
    campaign_id: campaignId, referred_by_client_id: referrerId,
  })).body;
  const converted = (await api('POST', `/api/leads/${lead.id}/convert`, { title: `${name} job` })).body;
  await api('PUT', `/api/jobs/${converted.job.id}/budget`, { contract: String(contract) });
  return { lead, job: converted.job };
}

/* --------------------------------------------------------------------- */

describe('campaigns', () => {
  let campaignId;

  test('creates a campaign and rejects a duplicate name or bad channel', async () => {
    const res = await api('POST', '/api/campaigns', {
      name: 'Truck lettering', channel: 'truck', started_on: '2026-06-01',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.spend_cents, 0);
    assert.equal(res.body.lead_count, 0);
    campaignId = res.body.id;

    assert.equal((await api('POST', '/api/campaigns', { name: 'truck lettering', channel: 'web' })).status, 400);
    assert.equal((await api('POST', '/api/campaigns', { name: 'Radio', channel: 'skywriting' })).status, 400);
    assert.equal((await api('POST', '/api/campaigns', { channel: 'web' })).status, 400);
  });

  test('attributes spend, leads and won work to the campaign', async () => {
    await api('POST', '/api/expenses', {
      spent_on: today(), amount: '1200', category: 'other',
      description: 'Truck wrap', campaign_id: campaignId,
    });
    await api('POST', '/api/expenses', {
      spent_on: today(), amount: '400', category: 'other',
      description: 'Not a campaign cost',
    });

    await winWork({ campaignId, contract: 18000, name: 'Saw the truck' });
    await api('POST', '/api/leads', { name: 'Also saw the truck', campaign_id: campaignId });

    const campaign = (await api('GET', `/api/campaigns/${campaignId}`)).body;
    assert.equal(campaign.spend_cents, 120000, 'only campaign-tagged spend counts');
    assert.equal(campaign.lead_count, 2);
    assert.equal(campaign.won_count, 1);
    assert.equal(campaign.won_value_cents, 1800000);
    assert.equal(campaign.cost_per_lead_cents, 60000);
    assert.equal(campaign.cost_per_won_job_cents, 120000);
    assert.equal(campaign.return_multiple, 15);
    assert.equal(campaign.leads.length, 2);
  });

  test('rejects a campaign id that does not exist', async () => {
    assert.equal((await api('POST', '/api/leads', { name: 'X', campaign_id: 9999 })).status, 400);
    assert.equal((await api('POST', '/api/expenses',
      { spent_on: today(), amount: '10', category: 'fuel', campaign_id: 9999 })).status, 400);
  });

  test('deleting a campaign keeps the leads and the spend', async () => {
    const doomed = (await api('POST', '/api/campaigns', { name: 'Yard signs', channel: 'yard_sign' })).body;
    const lead = (await api('POST', '/api/leads', { name: 'Sign caller', campaign_id: doomed.id })).body;
    const expense = (await api('POST', '/api/expenses',
      { spent_on: today(), amount: '80', category: 'other', campaign_id: doomed.id })).body;

    assert.equal((await api('DELETE', `/api/campaigns/${doomed.id}`)).status, 200);
    assert.equal((await api('GET', `/api/leads/${lead.id}`)).body.campaign_id, null);
    assert.equal((await api('GET', `/api/expenses/${expense.id}`)).status, 200,
      'the spend is still a real expense, it just stops being attributed');
  });
});

describe('referrals', () => {
  test('credits the client who sent the work', async () => {
    const dana = (await api('POST', '/api/clients', { name: 'Dana Whitfield' })).body;
    await winWork({ referrerId: dana.id, contract: 24000, name: 'Dana sent them' });
    await winWork({ referrerId: dana.id, contract: 6000, name: 'Dana sent them again' });
    await api('POST', '/api/leads', { name: 'Dana mentioned us', referred_by_client_id: dana.id });

    const report = (await api('GET', '/api/reports/marketing')).body;
    const row = report.referrals.find((r) => r.client_id === dana.id);
    assert.ok(row, 'Dana should appear on the referral leaderboard');
    assert.equal(row.referred_count, 3);
    assert.equal(row.won_count, 2);
    assert.equal(row.won_value_cents, 3000000);
  });

  test('rejects a referrer who is not a client', async () => {
    assert.equal((await api('POST', '/api/leads',
      { name: 'X', referred_by_client_id: 9999 })).status, 400);
  });
});

describe('review requests', () => {
  let jobId;

  test('opens automatically when a job is completed', async () => {
    const client = (await api('POST', '/api/clients', { name: 'Ellen Kovac', email: 'ek@example.com' })).body;
    const job = (await api('POST', '/api/jobs', { title: 'Deck rebuild', client_id: client.id })).body;
    jobId = job.id;

    for (const status of ['estimating', 'scheduled', 'in_progress']) {
      await api('POST', `/api/jobs/${jobId}/status`, { status });
    }
    assert.equal((await api('GET', '/api/review-requests?status=pending')).body.requests
      .filter((r) => r.job_id === jobId).length, 0, 'nothing to ask about until the job is done');

    await api('POST', `/api/jobs/${jobId}/status`, { status: 'complete' });

    const pending = (await api('GET', '/api/review-requests?status=pending')).body;
    const request = pending.requests.find((r) => r.job_id === jobId);
    assert.ok(request, 'completing a job should queue a review request');
    assert.equal(request.client_name, 'Ellen Kovac');
    assert.equal(request.client_email, 'ek@example.com');
  });

  test('does not queue a second request for the same job', async () => {
    await api('POST', `/api/jobs/${jobId}/status`, { status: 'punch_list' });
    await api('POST', `/api/jobs/${jobId}/status`, { status: 'complete' });

    const all = (await api('GET', '/api/review-requests')).body.requests.filter((r) => r.job_id === jobId);
    assert.equal(all.length, 1, 'asking the same customer twice is worse than not asking');
    assert.equal((await api('POST', `/api/jobs/${jobId}/review-request`, {})).status, 400);
  });

  test('walks through asked and answered, stamping the dates itself', async () => {
    const request = (await api('GET', '/api/review-requests')).body.requests.find((r) => r.job_id === jobId);

    const sent = (await api('PATCH', `/api/review-requests/${request.id}`,
      { status: 'sent', channel: 'email' })).body;
    assert.equal(sent.status, 'sent');
    assert.equal(sent.requested_on, today());
    assert.equal(sent.responded_on, null);

    const received = (await api('PATCH', `/api/review-requests/${request.id}`,
      { status: 'received', rating: 5, notes: 'Left five stars on Google' })).body;
    assert.equal(received.status, 'received');
    assert.equal(received.responded_on, today());
    assert.equal(received.rating, 5);
    assert.equal(received.requested_on, sent.requested_on, 'the ask date must not be overwritten');
  });

  test('rejects a rating outside one to five', async () => {
    const request = (await api('GET', '/api/review-requests')).body.requests.find((r) => r.job_id === jobId);
    for (const rating of [0, 6, 4.5, 'great']) {
      assert.equal((await api('PATCH', `/api/review-requests/${request.id}`, { rating })).status, 400,
        `accepted rating ${rating}`);
    }
  });

  test('a job with no client still queues a request', async () => {
    const job = (await api('POST', '/api/jobs', { title: 'Cash job' })).body;
    for (const status of ['scheduled', 'in_progress', 'complete']) {
      await api('POST', `/api/jobs/${job.id}/status`, { status });
    }
    const request = (await api('GET', '/api/review-requests')).body.requests.find((r) => r.job_id === job.id);
    assert.ok(request);
    assert.equal(request.client_id, null);
  });
});

describe('marketing report', () => {
  test('totals spend against work won, and funnels the reviews', async () => {
    const res = await api('GET', '/api/reports/marketing');
    assert.equal(res.status, 200);
    const { totals, campaigns, referrals, reviews } = res.body;

    assert.equal(totals.spend_cents, campaigns.reduce((n, c) => n + c.spend_cents, 0));
    assert.equal(totals.leads, campaigns.reduce((n, c) => n + c.lead_count, 0));
    assert.equal(totals.cost_per_won_job_cents,
      totals.won ? Math.round(totals.spend_cents / totals.won) : null);

    assert.ok(referrals.length >= 1);

    assert.equal(reviews.received, 1);
    assert.equal(reviews.average_rating, 5);
    assert.equal(reviews.response_rate_percent,
      Math.round((reviews.received / reviews.asked) * 1000) / 10);
    assert.ok(reviews.waiting_to_ask >= 1);
  });

  test('reports nothing rather than dividing by zero on a fresh install', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'contracting-fresh4-'));
    const { server: s2 } = createApp({ dbFile: join(fresh, 'blank.db'), dataDir: fresh });
    await new Promise((resolve) => s2.listen(0, resolve));
    const url = `http://127.0.0.1:${s2.address().port}`;
    const jar = await signIn(url, { username: 'new', display_name: 'New', password: 'a long enough one' });

    const report = await (await fetch(`${url}/api/reports/marketing`, { headers: { cookie: jar } })).json();
    assert.equal(report.totals.spend_cents, 0);
    assert.equal(report.totals.cost_per_won_job_cents, null);
    assert.equal(report.reviews.response_rate_percent, null);
    assert.equal(report.reviews.average_rating, null);
    assert.deepEqual(report.referrals, []);

    await new Promise((resolve) => s2.close(resolve));
    rmSync(fresh, { recursive: true, force: true });
  });
});
