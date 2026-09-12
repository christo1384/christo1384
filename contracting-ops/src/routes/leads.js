import { sendJson, readJson, notFound, badRequest } from '../lib/http.js';
import {
  requiredText, optionalText, optionalEnum, requiredEnum, optionalDate, pathId, buildPatch,
} from '../lib/validate.js';
import { transaction } from '../db.js';
import { statusLabel } from '../lib/workflow.js';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
export const LEAD_SOURCES = ['referral', 'repeat', 'web', 'sign', 'other'];

export function registerLeadRoutes(router, db) {
  router.get('/api/leads', (req, res, { query }) => {
    const where = [];
    const args = {};

    const status = query.get('status');
    if (status) {
      const keys = status.split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = keys.filter((k) => !LEAD_STATUSES.includes(k));
      if (unknown.length) throw badRequest(`Unknown lead status: ${unknown.join(', ')}`);
      where.push(`l.status IN (${keys.map((_, i) => `:s${i}`).join(', ')})`);
      keys.forEach((k, i) => { args[`s${i}`] = k; });
    }
    if (query.get('open') === '1') where.push("l.status IN ('new', 'contacted', 'qualified')");

    const rows = db.prepare(
      `SELECT l.*, j.job_number, j.title AS job_title
         FROM leads l LEFT JOIN jobs j ON j.id = l.converted_job_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE l.status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'qualified' THEN 2 ELSE 3 END,
                 l.received_on DESC, l.id DESC`,
    ).all(args);

    const counts = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all().map((r) => [r.status, r.n]),
    );
    sendJson(res, 200, { counts, leads: rows });
  });

  router.post('/api/leads', async (req, res, { user }) => {
    const body = await readJson(req);
    const info = db.prepare(
      `INSERT INTO leads (name, phone, email, source, description, received_on, status, created_by)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?)`,
    ).run(
      requiredText(body, 'name', { max: 200 }),
      optionalText(body, 'phone', { max: 60 }) ?? null,
      optionalText(body, 'email', { max: 200 }) ?? null,
      optionalEnum(body, 'source', LEAD_SOURCES) ?? null,
      optionalText(body, 'description') ?? null,
      optionalDate(body, 'received_on') ?? null,
      optionalEnum(body, 'status', LEAD_STATUSES) ?? 'new',
      user?.id ?? null,
    );
    sendJson(res, 201, getLead(db, Number(info.lastInsertRowid)));
  });

  router.get('/api/leads/:id', (req, res, { params }) => {
    const lead = getLead(db, pathId(params));
    if (!lead) throw notFound('Lead not found');
    sendJson(res, 200, lead);
  });

  router.patch('/api/leads/:id', async (req, res, { params }) => {
    const id = pathId(params);
    const existing = getLead(db, id);
    if (!existing) throw notFound('Lead not found');
    const body = await readJson(req);

    if ('status' in body) {
      const next = requiredEnum(body, 'status', LEAD_STATUSES);
      if (next === 'converted' && existing.status !== 'converted') {
        throw badRequest('Use POST /api/leads/:id/convert to turn a lead into a job');
      }
    }

    const { columns, values } = buildPatch({
      name: 'name' in body ? requiredText(body, 'name', { max: 200 }) : undefined,
      phone: optionalText(body, 'phone', { max: 60 }),
      email: optionalText(body, 'email', { max: 200 }),
      source: optionalEnum(body, 'source', LEAD_SOURCES),
      description: optionalText(body, 'description'),
      received_on: optionalDate(body, 'received_on'),
      status: 'status' in body ? requiredEnum(body, 'status', LEAD_STATUSES) : undefined,
      lost_reason: optionalText(body, 'lost_reason', { max: 500 }),
    });

    if (columns.length) {
      db.prepare(`UPDATE leads SET ${columns.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, id);
    }
    sendJson(res, 200, getLead(db, id));
  });

  /**
   * One transaction: find or create the client, open the job, and mark the lead
   * converted. Capturing an enquiry and starting work on it is one decision,
   * so it should not be able to half-happen.
   */
  router.post('/api/leads/:id/convert', async (req, res, { params, user }) => {
    const id = pathId(params);
    const lead = getLead(db, id);
    if (!lead) throw notFound('Lead not found');
    if (lead.status === 'converted') throw badRequest('That lead has already been converted');

    const body = await readJson(req);
    const clientId = body.client_id ? Number(body.client_id) : null;
    if (clientId && !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) {
      throw badRequest('client_id does not match a client');
    }
    const title = optionalText(body, 'title', { max: 200 }) || `${lead.name} — enquiry`;

    const result = transaction(db, () => {
      const useClientId = clientId ?? Number(db.prepare(
        'INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)',
      ).run(lead.name, lead.phone, lead.email).lastInsertRowid);

      const status = optionalEnum(body, 'job_status', ['lead', 'estimating']) ?? 'estimating';
      const jobId = Number(db.prepare(
        `INSERT INTO jobs (client_id, title, description, site_address, status, start_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        useClientId, title, lead.description,
        optionalText(body, 'site_address', { max: 400 }) ?? null,
        status,
        optionalDate(body, 'start_date') ?? null,
      ).lastInsertRowid);

      db.prepare('UPDATE jobs SET job_number = ? WHERE id = ?')
        .run(`J-${String(jobId).padStart(4, '0')}`, jobId);
      db.prepare(
        `INSERT INTO job_events (job_id, kind, to_status, body, author)
         VALUES (?, 'created', ?, ?, ?)`,
      ).run(
        jobId, status,
        `Converted from lead: ${lead.name}${lead.source ? ` (${lead.source})` : ''}`,
        user?.display_name ?? null,
      );

      db.prepare(
        `UPDATE leads SET status = 'converted', converted_job_id = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).run(jobId, id);

      return { client_id: useClientId, job_id: jobId, status };
    });

    sendJson(res, 201, {
      lead: getLead(db, id),
      job: db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.job_id),
      client_id: result.client_id,
      moved_to: statusLabel(result.status),
    });
  });

  router.delete('/api/leads/:id', (req, res, { params }) => {
    const id = pathId(params);
    if (!getLead(db, id)) throw notFound('Lead not found');
    db.prepare('DELETE FROM leads WHERE id = ?').run(id);
    sendJson(res, 200, { deleted: id });
  });
}

function getLead(db, id) {
  return db.prepare(
    `SELECT l.*, j.job_number, j.title AS job_title
       FROM leads l LEFT JOIN jobs j ON j.id = l.converted_job_id WHERE l.id = ?`,
  ).get(id) ?? null;
}
