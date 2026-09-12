import { sendJson, readJson, notFound, badRequest } from '../lib/http.js';
import {
  requiredText, optionalText, optionalEnum, requiredEnum, optionalDate, pathId, buildPatch,
} from '../lib/validate.js';

export const CAMPAIGN_CHANNELS = ['yard_sign', 'truck', 'web', 'print', 'social', 'sponsorship', 'other'];
export const REVIEW_STATUSES = ['pending', 'sent', 'received', 'declined'];
export const REVIEW_CHANNELS = ['email', 'text', 'in_person'];

export function registerMarketingRoutes(router, db) {
  /* ----------------------------- campaigns ---------------------------- */

  router.get('/api/campaigns', (req, res) => {
    sendJson(res, 200, db.prepare('SELECT * FROM campaigns ORDER BY started_on DESC, id DESC')
      .all().map((c) => withPerformance(db, c)));
  });

  router.post('/api/campaigns', async (req, res) => {
    const body = await readJson(req);
    const name = requiredText(body, 'name', { max: 200 });
    if (db.prepare('SELECT 1 FROM campaigns WHERE name = ?').get(name)) {
      throw badRequest('A campaign with that name already exists');
    }
    const info = db.prepare(
      `INSERT INTO campaigns (name, channel, started_on, ended_on, notes)
       VALUES (?, ?, COALESCE(?, date('now')), ?, ?)`,
    ).run(
      name,
      requiredEnum(body, 'channel', CAMPAIGN_CHANNELS),
      optionalDate(body, 'started_on') ?? null,
      optionalDate(body, 'ended_on') ?? null,
      optionalText(body, 'notes') ?? null,
    );
    sendJson(res, 201, getCampaign(db, Number(info.lastInsertRowid)));
  });

  router.get('/api/campaigns/:id', (req, res, { params }) => {
    const campaign = getCampaign(db, pathId(params));
    if (!campaign) throw notFound('Campaign not found');
    campaign.leads = db.prepare(
      `SELECT l.id, l.name, l.status, l.received_on, j.job_number
         FROM leads l LEFT JOIN jobs j ON j.id = l.converted_job_id
        WHERE l.campaign_id = ? ORDER BY l.received_on DESC`,
    ).all(campaign.id);
    sendJson(res, 200, campaign);
  });

  router.patch('/api/campaigns/:id', async (req, res, { params }) => {
    const id = pathId(params);
    if (!getCampaign(db, id)) throw notFound('Campaign not found');
    const body = await readJson(req);

    const { columns, values } = buildPatch({
      name: 'name' in body ? requiredText(body, 'name', { max: 200 }) : undefined,
      channel: 'channel' in body ? requiredEnum(body, 'channel', CAMPAIGN_CHANNELS) : undefined,
      started_on: optionalDate(body, 'started_on'),
      ended_on: optionalDate(body, 'ended_on'),
      notes: optionalText(body, 'notes'),
    });
    if (columns.length) db.prepare(`UPDATE campaigns SET ${columns.join(', ')} WHERE id = ?`).run(...values, id);

    sendJson(res, 200, getCampaign(db, id));
  });

  router.delete('/api/campaigns/:id', (req, res, { params }) => {
    const id = pathId(params);
    if (!getCampaign(db, id)) throw notFound('Campaign not found');
    // Leads and expenses keep their history; they simply stop being attributed.
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    sendJson(res, 200, { deleted: id });
  });

  /* -------------------------- review requests -------------------------- */

  router.get('/api/review-requests', (req, res, { query }) => {
    const status = query.get('status');
    if (status && !REVIEW_STATUSES.includes(status)) throw badRequest(`Unknown status: ${status}`);

    const rows = db.prepare(
      `SELECT r.*, j.job_number, j.title AS job_title, j.status AS job_status,
              c.name AS client_name, c.email AS client_email, c.phone AS client_phone
         FROM review_requests r
         JOIN jobs j ON j.id = r.job_id
         LEFT JOIN clients c ON c.id = r.client_id
        ${status ? 'WHERE r.status = :status' : ''}
        ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, r.created_at DESC`,
    ).all(status ? { status } : {});

    const counts = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) AS n FROM review_requests GROUP BY status').all()
        .map((r) => [r.status, r.n]),
    );
    sendJson(res, 200, { counts, requests: rows });
  });

  router.post('/api/jobs/:id/review-request', (req, res, { params }) => {
    const jobId = pathId(params);
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) throw notFound('Job not found');
    if (db.prepare('SELECT 1 FROM review_requests WHERE job_id = ?').get(jobId)) {
      throw badRequest('This job already has a review request');
    }
    sendJson(res, 201, openRequest(db, job));
  });

  router.patch('/api/review-requests/:id', async (req, res, { params }) => {
    const id = pathId(params);
    const existing = db.prepare('SELECT * FROM review_requests WHERE id = ?').get(id);
    if (!existing) throw notFound('Review request not found');
    const body = await readJson(req);

    const status = 'status' in body ? requiredEnum(body, 'status', REVIEW_STATUSES) : undefined;
    let rating;
    if ('rating' in body) {
      if (body.rating === null || body.rating === '') rating = null;
      else {
        rating = Number(body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          throw badRequest('"rating" must be a whole number from 1 to 5');
        }
      }
    }

    const { columns, values } = buildPatch({
      status,
      channel: optionalEnum(body, 'channel', REVIEW_CHANNELS),
      notes: optionalText(body, 'notes'),
      rating,
      // The dates follow the status rather than being typed in by hand.
      requested_on: status && ['sent', 'received'].includes(status) && !existing.requested_on
        ? new Date().toISOString().slice(0, 10) : undefined,
      responded_on: status && ['received', 'declined'].includes(status)
        ? new Date().toISOString().slice(0, 10) : undefined,
    });

    if (columns.length) {
      db.prepare(`UPDATE review_requests SET ${columns.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, id);
    }
    sendJson(res, 200, db.prepare('SELECT * FROM review_requests WHERE id = ?').get(id));
  });

  /* ------------------------------ report ------------------------------ */

  router.get('/api/reports/marketing', (req, res) => {
    const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY started_on DESC')
      .all().map((c) => withPerformance(db, c));

    const spend = campaigns.reduce((n, c) => n + c.spend_cents, 0);
    const won = campaigns.reduce((n, c) => n + c.won_count, 0);

    sendJson(res, 200, {
      campaigns,
      totals: {
        spend_cents: spend,
        leads: campaigns.reduce((n, c) => n + c.lead_count, 0),
        won,
        cost_per_won_job_cents: won ? Math.round(spend / won) : null,
      },
      referrals: referralLeaderboard(db),
      reviews: reviewFunnel(db),
    });
  });
}

/** Opens a pending request; used by the route and by a job reaching complete. */
export function openRequest(db, job) {
  const info = db.prepare(
    'INSERT INTO review_requests (job_id, client_id) VALUES (?, ?)',
  ).run(job.id, job.client_id ?? null);
  return db.prepare('SELECT * FROM review_requests WHERE id = ?').get(Number(info.lastInsertRowid));
}

/** Called when a job reaches complete. Never fails the status change. */
export function openRequestOnCompletion(db, job) {
  try {
    if (db.prepare('SELECT 1 FROM review_requests WHERE job_id = ?').get(job.id)) return;
    openRequest(db, job);
  } catch {
    // A missing review request must never block a crew from closing a job out.
  }
}

function getCampaign(db, id) {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  return row ? withPerformance(db, row) : null;
}

/**
 * What a campaign cost and what it brought in. Won value is the contract
 * amount of the jobs its leads became, so it only counts work actually priced.
 */
function withPerformance(db, campaign) {
  const spend = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenses WHERE campaign_id = ?',
  ).get(campaign.id).c;

  const leads = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted
       FROM leads WHERE campaign_id = ?`,
  ).get(campaign.id);

  const wonValue = db.prepare(
    `SELECT COALESCE(SUM(b.contract_cents), 0) AS c
       FROM leads l JOIN job_budgets b ON b.job_id = l.converted_job_id
      WHERE l.campaign_id = ?`,
  ).get(campaign.id).c;

  const won = leads.converted ?? 0;
  return {
    ...campaign,
    spend_cents: spend,
    lead_count: leads.total,
    won_count: won,
    won_value_cents: wonValue,
    cost_per_lead_cents: leads.total ? Math.round(spend / leads.total) : null,
    cost_per_won_job_cents: won ? Math.round(spend / won) : null,
    return_multiple: spend ? Math.round((wonValue / spend) * 10) / 10 : null,
  };
}

function referralLeaderboard(db) {
  return db.prepare(
    `SELECT c.id AS client_id, c.name AS client_name,
            COUNT(l.id) AS referred_count,
            SUM(CASE WHEN l.status = 'converted' THEN 1 ELSE 0 END) AS won_count,
            COALESCE(SUM(b.contract_cents), 0) AS won_value_cents
       FROM leads l
       JOIN clients c ON c.id = l.referred_by_client_id
       LEFT JOIN job_budgets b ON b.job_id = l.converted_job_id
      GROUP BY c.id
      ORDER BY won_value_cents DESC, referred_count DESC
      LIMIT 20`,
  ).all();
}

function reviewFunnel(db) {
  const counts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM review_requests GROUP BY status').all()
      .map((r) => [r.status, r.n]),
  );
  const received = counts.received ?? 0;
  const asked = (counts.sent ?? 0) + received + (counts.declined ?? 0);
  const rating = db.prepare(
    "SELECT AVG(rating) AS avg FROM review_requests WHERE rating IS NOT NULL",
  ).get().avg;

  return {
    counts,
    waiting_to_ask: counts.pending ?? 0,
    asked,
    received,
    response_rate_percent: asked ? Math.round((received / asked) * 1000) / 10 : null,
    average_rating: rating === null ? null : Math.round(rating * 10) / 10,
  };
}
