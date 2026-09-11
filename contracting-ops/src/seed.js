// Loads a handful of realistic jobs so the app is worth looking at on day one.
// Usage: npm run seed            (refuses to touch a database that has data)
//        npm run seed -- --force (wipes clients/jobs/events first)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_FILE ?? join(here, '..', 'data', 'ops.db');
const force = process.argv.includes('--force');

const db = openDb(dbFile);
const existing = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;

if (existing > 0 && !force) {
  console.error(`${dbFile} already has ${existing} jobs. Re-run with --force to replace them.`);
  process.exit(1);
}

const daysOut = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const CLIENTS = [
  { name: 'Dana Whitfield', phone: '(512) 555-0143', email: 'dana.w@example.com', address: '812 Larkspur Ln' },
  { name: 'Ruiz Property Group', company: 'Ruiz Property Group', phone: '(512) 555-0178', email: 'ops@ruizpg.example.com' },
  { name: 'Ellen Kovac', phone: '(512) 555-0119', email: 'ekovac@example.com', address: '2440 Ridge Rd' },
  { name: 'Sam Boateng', phone: '(512) 555-0166' },
];

const JOBS = [
  { client: 0, title: 'Kitchen remodel - full gut', site_address: '812 Larkspur Ln', priority: 'high',
    start_date: daysOut(-21), target_end_date: daysOut(9),
    description: 'Full gut, new cabinets, quartz tops, move the range wall 18".',
    track: [['estimating', -40, 'Walked the space, took measurements'], ['bid_sent', -34, 'Bid emailed'],
            ['scheduled', -27, 'Signed, deposit received'], ['in_progress', -21, 'Demo started']],
    notes: [[-8, 'Cabinets delivered, two doors damaged - replacements ordered'], [-2, 'Countertop template Thursday']] },

  { client: 1, title: 'Unit 4B bathroom refresh', site_address: '1100 Ferris St #4B', priority: 'normal',
    start_date: daysOut(-6), target_end_date: daysOut(4),
    track: [['estimating', -20, null], ['bid_sent', -17, null], ['scheduled', -12, 'PO issued'],
            ['in_progress', -6, null], ['punch_list', -1, 'Tile and vanity done, caulk and trim left']] },

  { client: 2, title: 'Rear deck rebuild', site_address: '2440 Ridge Rd', priority: 'normal',
    start_date: daysOut(6), target_end_date: daysOut(20),
    description: 'Tear out the old deck, new footings, composite decking, 32 lf of rail.',
    track: [['estimating', -15, null], ['bid_sent', -11, 'Bid sent with two decking options'],
            ['scheduled', -3, 'Went with the composite option']] },

  { client: 3, title: 'Garage slab and apron', site_address: '77 Cedar Hollow', priority: 'normal',
    start_date: daysOut(13),
    track: [['estimating', -9, 'Needs a soils check before I can price the footing']] },

  { client: 1, title: 'Unit 2A window replacement (10 units)', priority: 'low',
    track: [['estimating', -30, null], ['bid_sent', -26, 'Bid sent, no answer yet']] },

  { client: 0, title: 'Powder room vanity swap', site_address: '812 Larkspur Ln',
    start_date: daysOut(-60), target_end_date: daysOut(-57),
    track: [['scheduled', -64, null], ['in_progress', -60, null], ['complete', -57, 'Signed off, invoice to follow']] },

  { client: 2, title: 'Detached studio build', priority: 'low',
    track: [['estimating', -50, null], ['cancelled', -35, 'Owner postponed until next year']] },

  { client: null, title: 'Roof leak - referral from Dana', description: 'Called about a leak over the porch.',
    track: [] },
];

transaction(db, () => {
  if (force) {
    db.exec('DELETE FROM job_events; DELETE FROM jobs; DELETE FROM clients;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('job_events', 'jobs', 'clients')");
  }

  const clientIds = CLIENTS.map((c) => Number(
    db.prepare('INSERT INTO clients (name, company, phone, email, address) VALUES (?, ?, ?, ?, ?)')
      .run(c.name, c.company ?? null, c.phone ?? null, c.email ?? null, c.address ?? null).lastInsertRowid,
  ));

  for (const job of JOBS) {
    const status = job.track.length ? job.track.at(-1)[0] : 'lead';
    const id = Number(db.prepare(
      `INSERT INTO jobs (client_id, title, description, site_address, status, priority, start_date, target_end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      job.client === null ? null : clientIds[job.client],
      job.title, job.description ?? null, job.site_address ?? null,
      status, job.priority ?? 'normal', job.start_date ?? null, job.target_end_date ?? null,
    ).lastInsertRowid);

    db.prepare('UPDATE jobs SET job_number = ? WHERE id = ?').run(`J-${String(id).padStart(4, '0')}`, id);

    const firstOffset = job.track.length ? job.track[0][1] - 2 : -1;
    addEvent(id, 'created', null, 'lead', 'Job created as Lead', firstOffset);

    let from = 'lead';
    for (const [to, offset, note] of job.track) {
      addEvent(id, 'status_change', from, to, note, offset);
      from = to;
    }
    for (const [offset, body] of job.notes ?? []) addEvent(id, 'note', null, null, body, offset);
  }
});

function addEvent(jobId, kind, fromStatus, toStatus, body, dayOffset) {
  db.prepare(
    `INSERT INTO job_events (job_id, kind, from_status, to_status, body, author, created_at)
     VALUES (?, ?, ?, ?, ?, 'Mike', datetime('now', ?))`,
  ).run(jobId, kind, fromStatus, toStatus, body ?? null, `${dayOffset} days`);
}

const counts = db.prepare('SELECT (SELECT COUNT(*) FROM clients) AS c, (SELECT COUNT(*) FROM jobs) AS j').get();
console.log(`Seeded ${counts.c} clients and ${counts.j} jobs into ${dbFile}`);
db.close();
