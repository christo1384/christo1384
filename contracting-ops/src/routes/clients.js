import { sendJson, readJson, notFound } from '../lib/http.js';
import { requiredText, optionalText, pathId, buildPatch } from '../lib/validate.js';

export function registerClientRoutes(router, db) {
  router.get('/api/clients', (req, res, { query }) => {
    const search = (query.get('search') ?? '').trim();
    const rows = search
      ? db.prepare(
          `SELECT * FROM clients
            WHERE name LIKE :q OR company LIKE :q OR phone LIKE :q OR email LIKE :q
            ORDER BY name COLLATE NOCASE`,
        ).all({ q: `%${search}%` })
      : db.prepare('SELECT * FROM clients ORDER BY name COLLATE NOCASE').all();

    const counts = db.prepare(
      `SELECT client_id, COUNT(*) AS n FROM jobs WHERE client_id IS NOT NULL GROUP BY client_id`,
    ).all();
    const jobCount = new Map(counts.map((r) => [r.client_id, r.n]));

    sendJson(res, 200, rows.map((c) => ({ ...c, job_count: jobCount.get(c.id) ?? 0 })));
  });

  router.post('/api/clients', async (req, res) => {
    const body = await readJson(req);
    const info = db.prepare(
      `INSERT INTO clients (name, company, phone, email, address, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      requiredText(body, 'name', { max: 200 }),
      optionalText(body, 'company', { max: 200 }) ?? null,
      optionalText(body, 'phone', { max: 60 }) ?? null,
      optionalText(body, 'email', { max: 200 }) ?? null,
      optionalText(body, 'address', { max: 400 }) ?? null,
      optionalText(body, 'notes') ?? null,
    );
    sendJson(res, 201, getClient(db, Number(info.lastInsertRowid)));
  });

  router.get('/api/clients/:id', (req, res, { params }) => {
    const client = getClient(db, pathId(params));
    if (!client) throw notFound('Client not found');
    client.jobs = db.prepare(
      'SELECT id, job_number, title, status, start_date FROM jobs WHERE client_id = ? ORDER BY created_at DESC',
    ).all(client.id);
    sendJson(res, 200, client);
  });

  router.patch('/api/clients/:id', async (req, res, { params }) => {
    const id = pathId(params);
    if (!getClient(db, id)) throw notFound('Client not found');
    const body = await readJson(req);

    const { columns, values } = buildPatch({
      name: 'name' in body ? requiredText(body, 'name', { max: 200 }) : undefined,
      company: optionalText(body, 'company', { max: 200 }),
      phone: optionalText(body, 'phone', { max: 60 }),
      email: optionalText(body, 'email', { max: 200 }),
      address: optionalText(body, 'address', { max: 400 }),
      notes: optionalText(body, 'notes'),
    });

    if (columns.length) {
      db.prepare(`UPDATE clients SET ${columns.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, id);
    }
    sendJson(res, 200, getClient(db, id));
  });

  router.delete('/api/clients/:id', (req, res, { params }) => {
    const id = pathId(params);
    if (!getClient(db, id)) throw notFound('Client not found');
    // Jobs survive the client record; client_id is set to NULL by the FK rule.
    db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    sendJson(res, 200, { deleted: id });
  });
}

function getClient(db, id) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id) ?? null;
}
