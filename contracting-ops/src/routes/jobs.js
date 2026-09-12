import { sendJson, readJson, notFound, badRequest } from '../lib/http.js';
import {
  requiredText, optionalText, optionalEnum, requiredEnum, optionalDate, optionalId, pathId, buildPatch,
} from '../lib/validate.js';
import { transaction } from '../db.js';
import { openRequestOnCompletion } from './marketing.js';
import {
  STATUS_KEYS, PRIORITIES, canTransition, allowedNext, statusLabel, groupKeys,
} from '../lib/workflow.js';

export function registerJobRoutes(router, db) {
  router.get('/api/jobs', (req, res, { query }) => {
    const where = [];
    const args = {};

    const status = query.get('status');
    if (status) {
      const keys = status.split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = keys.filter((k) => !STATUS_KEYS.includes(k));
      if (unknown.length) throw badRequest(`Unknown status: ${unknown.join(', ')}`);
      where.push(`j.status IN (${keys.map((_, i) => `:s${i}`).join(', ')})`);
      keys.forEach((k, i) => { args[`s${i}`] = k; });
    }

    const group = query.get('group');
    if (group) {
      const keys = groupKeys(group);
      if (!keys.length) throw badRequest(`Unknown group: ${group}`);
      where.push(`j.status IN (${keys.map((_, i) => `:g${i}`).join(', ')})`);
      keys.forEach((k, i) => { args[`g${i}`] = k; });
    }

    const clientId = query.get('client_id');
    if (clientId) {
      where.push('j.client_id = :client_id');
      args.client_id = Number(clientId);
    }

    const search = (query.get('search') ?? '').trim();
    if (search) {
      where.push('(j.title LIKE :q OR j.job_number LIKE :q OR j.site_address LIKE :q OR c.name LIKE :q)');
      args.q = `%${search}%`;
    }

    const rows = db.prepare(
      `SELECT j.*, c.name AS client_name, c.phone AS client_phone,
              (SELECT MAX(created_at) FROM job_events e WHERE e.job_id = j.id) AS last_activity_at
         FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE j.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                 COALESCE(j.start_date, '9999-12-31'), j.id DESC`,
    ).all(args);

    sendJson(res, 200, rows.map(decorate));
  });

  router.post('/api/jobs', async (req, res, { user }) => {
    const body = await readJson(req);
    const title = requiredText(body, 'title', { max: 200 });
    const clientId = optionalId(body, 'client_id') ?? null;
    if (clientId && !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) {
      throw badRequest('client_id does not match a client');
    }
    const status = optionalEnum(body, 'status', STATUS_KEYS) ?? 'lead';

    const job = transaction(db, () => {
      const info = db.prepare(
        `INSERT INTO jobs (client_id, title, description, site_address, status, priority, start_date, target_end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        clientId,
        title,
        optionalText(body, 'description') ?? null,
        optionalText(body, 'site_address', { max: 400 }) ?? null,
        status,
        optionalEnum(body, 'priority', PRIORITIES) ?? 'normal',
        optionalDate(body, 'start_date') ?? null,
        optionalDate(body, 'target_end_date') ?? null,
      );
      const id = Number(info.lastInsertRowid);
      db.prepare('UPDATE jobs SET job_number = ? WHERE id = ?').run(`J-${String(id).padStart(4, '0')}`, id);
      db.prepare(
        `INSERT INTO job_events (job_id, kind, to_status, body, author) VALUES (?, 'created', ?, ?, ?)`,
      ).run(id, status, `Job created as ${statusLabel(status)}`, author(body, user));
      return getJob(db, id);
    });

    sendJson(res, 201, job);
  });

  router.get('/api/jobs/:id', (req, res, { params }) => {
    const job = getJob(db, pathId(params));
    if (!job) throw notFound('Job not found');
    job.events = listEvents(db, job.id);
    sendJson(res, 200, job);
  });

  router.patch('/api/jobs/:id', async (req, res, { params }) => {
    const id = pathId(params);
    const existing = getJob(db, id);
    if (!existing) throw notFound('Job not found');
    const body = await readJson(req);

    if ('status' in body) {
      throw badRequest('Use POST /api/jobs/:id/status to move a job through the workflow');
    }
    const clientId = optionalId(body, 'client_id');
    if (clientId && !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) {
      throw badRequest('client_id does not match a client');
    }

    const { columns, values } = buildPatch({
      client_id: clientId,
      title: 'title' in body ? requiredText(body, 'title', { max: 200 }) : undefined,
      description: optionalText(body, 'description'),
      site_address: optionalText(body, 'site_address', { max: 400 }),
      priority: optionalEnum(body, 'priority', PRIORITIES),
      start_date: optionalDate(body, 'start_date'),
      target_end_date: optionalDate(body, 'target_end_date'),
    });

    if (columns.length) {
      db.prepare(`UPDATE jobs SET ${columns.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, id);
    }
    const job = getJob(db, id);
    job.events = listEvents(db, id);
    sendJson(res, 200, job);
  });

  router.post('/api/jobs/:id/status', async (req, res, { params, user }) => {
    const id = pathId(params);
    const existing = getJob(db, id);
    if (!existing) throw notFound('Job not found');
    const body = await readJson(req);

    const to = requiredEnum(body, 'status', STATUS_KEYS);
    const from = existing.status;
    if (!canTransition(from, to)) {
      throw badRequest(
        `A job that is "${statusLabel(from)}" cannot move to "${statusLabel(to)}"`,
        { from, to, allowed: allowedNext(from) },
      );
    }

    const job = transaction(db, () => {
      if (from !== to) {
        db.prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, id);
      }
      db.prepare(
        `INSERT INTO job_events (job_id, kind, from_status, to_status, body, author)
         VALUES (?, 'status_change', ?, ?, ?, ?)`,
      ).run(id, from, to, optionalText(body, 'note') ?? null, author(body, user));

      // Finishing a job is the moment to ask for a review, and the moment it
      // is most likely to be forgotten.
      if (to === 'complete' && from !== 'complete') openRequestOnCompletion(db, existing);

      return getJob(db, id);
    });

    job.events = listEvents(db, id);
    sendJson(res, 200, job);
  });

  router.get('/api/jobs/:id/events', (req, res, { params }) => {
    const id = pathId(params);
    if (!getJob(db, id)) throw notFound('Job not found');
    sendJson(res, 200, listEvents(db, id));
  });

  router.post('/api/jobs/:id/events', async (req, res, { params, user }) => {
    const id = pathId(params);
    if (!getJob(db, id)) throw notFound('Job not found');
    const body = await readJson(req);

    const info = db.prepare(
      `INSERT INTO job_events (job_id, kind, body, author) VALUES (?, 'note', ?, ?)`,
    ).run(id, requiredText(body, 'body', { max: 5000 }), author(body, user));
    db.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").run(id);

    sendJson(res, 201, db.prepare('SELECT * FROM job_events WHERE id = ?').get(Number(info.lastInsertRowid)));
  });

  router.delete('/api/jobs/:id', (req, res, { params }) => {
    const id = pathId(params);
    if (!getJob(db, id)) throw notFound('Job not found');

    // Invoices hold the job with ON DELETE RESTRICT: billing history must not
    // be deleted out from under itself.
    const invoices = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE job_id = ?').get(id).n;
    if (invoices > 0) {
      throw badRequest(
        `This job has ${invoices} invoice${invoices === 1 ? '' : 's'} against it and cannot be deleted. `
        + 'Void the invoices first, or cancel the job instead.',
        { invoice_count: invoices },
      );
    }

    db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    sendJson(res, 200, { deleted: id });
  });
}

/** Who gets credit on the timeline: the signed-in user, or an explicit override. */
function author(body, user) {
  const value = typeof body.author === 'string' ? body.author.trim() : '';
  if (value) return value.slice(0, 100);
  return user?.display_name ?? null;
}

export function getJob(db, id) {
  const row = db.prepare(
    `SELECT j.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
            (SELECT MAX(created_at) FROM job_events e WHERE e.job_id = j.id) AS last_activity_at
       FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
      WHERE j.id = ?`,
  ).get(id);
  return row ? decorate(row) : null;
}

function listEvents(db, jobId) {
  return db.prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at DESC, id DESC').all(jobId);
}

function decorate(row) {
  return { ...row, status_label: statusLabel(row.status), allowed_next: allowedNext(row.status) };
}
