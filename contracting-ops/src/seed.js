// Loads a handful of realistic jobs so the app is worth looking at on day one.
// Usage: npm run seed            (refuses to touch a database that has data)
//        npm run seed -- --force (wipes clients/jobs/events first)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from './db.js';
import { recomputeStatus } from './routes/invoices.js';

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

const VENDORS = [
  { name: 'Buildright Lumber', category: 'lumber' },
  { name: 'Ace Plumbing Supply', category: 'plumbing' },
  { name: 'Metro Tool Rental', category: 'rental' },
  { name: 'County Permits Office', category: 'permits' },
  { name: 'Delgado Tile & Stone', category: 'subcontractor' },
];

// Keyed by index into JOBS above.
const BUDGETS = {
  0: { contract: 48500, materials: 22000, labor: 16000, other: 3000 },
  1: { contract: 9200, materials: 4200, labor: 2800, other: 500 },
  2: { contract: 16400, materials: 8600, labor: 4500, other: 900 },
};

const EXPENSES = [
  { job: 0, vendor: 'Buildright Lumber', day: -20, amount: 4318.42, category: 'materials', description: 'Framing lumber and sheathing' },
  { job: 0, vendor: 'Metro Tool Rental', day: -19, amount: 285.00, category: 'rental', description: 'Dumpster, one week' },
  { job: 0, vendor: 'County Permits Office', day: -25, amount: 420.00, category: 'permit', method: 'check' },
  { job: 0, vendor: 'Delgado Tile & Stone', day: -9, amount: 6150.00, category: 'subcontractor', method: 'check', description: 'Backsplash and floor tile' },
  { job: 0, vendor: 'Ace Plumbing Supply', day: -8, amount: 1877.65, category: 'materials', description: 'Sink, faucet, rough-in' },
  { job: 0, day: -6, amount: 2400.00, category: 'labor', method: 'check', description: 'Crew, week of the 12th' },
  { job: 0, vendor: 'Buildright Lumber', day: -3, amount: 612.18, category: 'materials', description: 'Cabinet trim and hardware' },

  { job: 1, vendor: 'Ace Plumbing Supply', day: -5, amount: 1140.20, category: 'materials', description: 'Vanity and shower valve' },
  { job: 1, day: -4, amount: 1600.00, category: 'labor', method: 'check' },
  { job: 1, vendor: 'Delgado Tile & Stone', day: -2, amount: 980.00, category: 'subcontractor', method: 'check' },

  { job: 2, vendor: 'Buildright Lumber', day: -1, amount: 3890.55, category: 'materials', description: 'Composite decking and rail' },

  { job: null, day: -22, amount: 268.00, category: 'other', description: 'General liability, monthly', billable: false },
  { job: null, day: -15, amount: 92.40, category: 'fuel', description: 'Truck fuel', billable: false },
  { job: null, day: -7, amount: 268.00, category: 'other', description: 'General liability, monthly', billable: false },
  { job: null, day: -2, amount: 88.15, category: 'fuel', description: 'Truck fuel', billable: false },
];

/* Phase 3 demo data: leads, an estimate trail, and invoices part-paid. */
const LEADS = [
  { name: 'Priya Raman', phone: '(512) 555-0188', source: 'referral', day: -2,
    description: 'Kitchen island and new pendants', status: 'new' },
  { name: 'Tom Halvorsen', phone: '(512) 555-0191', source: 'sign', day: -5,
    description: 'Wants a quote on re-siding the garage', status: 'contacted' },
  { name: 'Brookside HOA', email: 'board@brookside.example.com', source: 'web', day: -9,
    description: 'Three units need bathroom fans vented properly', status: 'qualified' },
  { name: 'Gary Nowak', phone: '(512) 555-0132', source: 'web', day: -24,
    description: 'Wanted a whole-house remodel', status: 'lost',
    lost_reason: 'Budget was about half what the work costs' },
  { name: 'Ellen Kovac', phone: '(512) 555-0119', source: 'referral', day: -18,
    description: 'Rear deck is rotting out', status: 'converted', job: 2 },
  { name: 'Sam Boateng', phone: '(512) 555-0166', source: 'repeat', day: -12,
    description: 'Garage slab and apron', status: 'converted', job: 3 },
];

// [description, quantity, unit, unit cost dollars, category]
const ESTIMATES = [
  { job: 0, status: 'accepted', markup: 18, day: -34, decided: -27,
    notes: 'Includes demo, haul-off and final clean. Appliances by owner.',
    lines: [
      ['Demolition and haul-off', 1, 'ls', 2400, 'labor'],
      ['Framing and blocking', 1, 'ls', 3100, 'labor'],
      ['Cabinets and install', 1, 'ls', 14800, 'materials'],
      ['Quartz countertops', 46, 'sf', 78, 'materials'],
      ['Electrical rough and trim', 1, 'ls', 3850, 'subcontractor'],
      ['Plumbing rough and trim', 1, 'ls', 2950, 'subcontractor'],
      ['Tile backsplash and floor', 190, 'sf', 14.5, 'subcontractor'],
      ['Paint', 1, 'ls', 1850, 'subcontractor'],
    ] },
  { job: 4, status: 'sent', markup: 12, day: -26,
    notes: 'Price holds for 30 days. Lead time on the units is six weeks.',
    lines: [
      ['Vinyl replacement windows', 10, 'ea', 615, 'materials'],
      ['Install and trim out', 10, 'ea', 210, 'labor'],
      ['Disposal', 1, 'ls', 180, 'other'],
    ] },
  { job: 3, status: 'draft', markup: 15, day: -6,
    lines: [
      ['Excavation and base', 1, 'ls', 2200, 'subcontractor'],
      ['Concrete, 4000 psi', 14, 'cy', 185, 'materials'],
      ['Place and finish', 26, 'hr', 68, 'labor'],
    ] },
];

const INVOICES = [
  { job: 5, issued: -55, due: -41, paid: [[-44, 'check', '2287']],
    lines: [['Powder room vanity swap, labor and materials', 1, 1450]] },
  { job: 1, issued: -10, due: 4, paid: [[-3, 'ach', 'Ruiz PG 0912']], partial: 0.6,
    lines: [['Bathroom refresh, progress billing', 1, 6400]] },
  { job: 0, issued: null, due: null, paid: [],
    lines: [['Kitchen remodel, first progress billing', 1, 18000]] },
];

const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const isoAt = (offset) => new Date(Date.now() + offset * 86400000).toISOString().replace('T', ' ').slice(0, 19);

transaction(db, () => {
  if (force) {
    db.exec(`DELETE FROM payments; DELETE FROM invoice_lines; DELETE FROM invoices;
             DELETE FROM estimate_lines; DELETE FROM estimates; DELETE FROM leads;`);
    db.exec('DELETE FROM attachments; DELETE FROM expenses; DELETE FROM vendors; DELETE FROM job_budgets;');
    db.exec('DELETE FROM job_events; DELETE FROM jobs; DELETE FROM clients;');
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN
      ('job_events', 'jobs', 'clients', 'expenses', 'vendors', 'attachments',
       'leads', 'estimates', 'estimate_lines', 'invoices', 'invoice_lines', 'payments')`);
  }

  const clientIds = CLIENTS.map((c) => Number(
    db.prepare('INSERT INTO clients (name, company, phone, email, address) VALUES (?, ?, ?, ?, ?)')
      .run(c.name, c.company ?? null, c.phone ?? null, c.email ?? null, c.address ?? null).lastInsertRowid,
  ));

  const jobIds = [];
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
    jobIds.push(id);

    const firstOffset = job.track.length ? job.track[0][1] - 2 : -1;
    addEvent(id, 'created', null, 'lead', 'Job created as Lead', firstOffset);

    let from = 'lead';
    for (const [to, offset, note] of job.track) {
      addEvent(id, 'status_change', from, to, note, offset);
      from = to;
    }
    for (const [offset, body] of job.notes ?? []) addEvent(id, 'note', null, null, body, offset);
  }

  seedFinancials(jobIds);
  seedOperations(jobIds);
});

function seedOperations(jobIds) {
  for (const lead of LEADS) {
    db.prepare(
      `INSERT INTO leads (name, phone, email, source, description, received_on, status, lost_reason, converted_job_id, created_at)
       VALUES (?, ?, ?, ?, ?, date('now', ?), ?, ?, ?, datetime('now', ?))`,
    ).run(
      lead.name, lead.phone ?? null, lead.email ?? null, lead.source ?? null,
      lead.description ?? null, `${lead.day} days`, lead.status, lead.lost_reason ?? null,
      lead.job === undefined ? null : jobIds[lead.job], `${lead.day} days`,
    );
  }

  for (const est of ESTIMATES) {
    const estimateId = Number(db.prepare(
      `INSERT INTO estimates (job_id, version, status, markup_percent, notes, sent_at, decided_at, created_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, datetime('now', ?))`,
    ).run(
      jobIds[est.job], est.status, est.markup, est.notes ?? null,
      est.status === 'draft' ? null : isoAt(est.day),
      est.decided === undefined ? null : isoAt(est.decided),
      `${est.day} days`,
    ).lastInsertRowid);

    est.lines.forEach(([description, quantity, unit, cost, category], index) => {
      db.prepare(
        `INSERT INTO estimate_lines (estimate_id, sort_order, description, quantity, unit, unit_cost_cents, category)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(estimateId, index, description, quantity, unit, Math.round(cost * 100), category);
    });

    // An accepted estimate is the contract amount, exactly as the API does it.
    if (est.status === 'accepted') {
      const subtotal = est.lines.reduce((n, [, q, , cost]) => n + Math.round(q * Math.round(cost * 100)), 0);
      const total = subtotal + Math.round(subtotal * (est.markup / 100));
      db.prepare(
        `INSERT INTO job_budgets (job_id, contract_cents) VALUES (?, ?)
         ON CONFLICT(job_id) DO UPDATE SET contract_cents = excluded.contract_cents`,
      ).run(jobIds[est.job], total);
    }
  }

  for (const inv of INVOICES) {
    const id = Number(db.prepare(
      `INSERT INTO invoices (job_id, invoice_number, status, issued_on, due_on, created_at)
       VALUES (?, 'pending', 'draft', ?, ?, datetime('now', ?))`,
    ).run(
      jobIds[inv.job],
      inv.issued === null ? null : isoDay(inv.issued),
      inv.due === null ? null : isoDay(inv.due),
      `${inv.issued ?? -1} days`,
    ).lastInsertRowid);
    db.prepare('UPDATE invoices SET invoice_number = ? WHERE id = ?').run(`INV-${String(id).padStart(4, '0')}`, id);

    inv.lines.forEach(([description, quantity, price], index) => {
      db.prepare(
        `INSERT INTO invoice_lines (invoice_id, sort_order, description, quantity, unit_price_cents)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, index, description, quantity, Math.round(price * 100));
    });

    const total = inv.lines.reduce((n, [, q, price]) => n + Math.round(q * Math.round(price * 100)), 0);
    for (const [day, method, reference] of inv.paid) {
      db.prepare(
        `INSERT INTO payments (invoice_id, received_on, amount_cents, method, reference, created_at)
         VALUES (?, date('now', ?), ?, ?, ?, datetime('now', ?))`,
      ).run(id, `${day} days`, Math.round(total * (inv.partial ?? 1)), method, reference, `${day} days`);
    }

    recomputeStatus(db, id);
  }
}

/* Phase 2 demo data: budgets and a few weeks of receipts. */
function seedFinancials(jobIds) {
  const vendorIds = Object.fromEntries(VENDORS.map((v) => [v.name, Number(
    db.prepare('INSERT INTO vendors (name, category) VALUES (?, ?)').run(v.name, v.category).lastInsertRowid,
  )]));

  for (const [index, budget] of Object.entries(BUDGETS)) {
    db.prepare(
      `INSERT INTO job_budgets (job_id, contract_cents, materials_budget_cents, labor_budget_cents, other_budget_cents)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(jobIds[index], budget.contract * 100, budget.materials * 100, budget.labor * 100, budget.other * 100);
  }

  for (const e of EXPENSES) {
    db.prepare(
      `INSERT INTO expenses (job_id, vendor_id, spent_on, amount_cents, category, payment_method, description, billable, created_at)
       VALUES (?, ?, date('now', ?), ?, ?, ?, ?, ?, datetime('now', ?))`,
    ).run(
      e.job === null ? null : jobIds[e.job],
      e.vendor ? vendorIds[e.vendor] : null,
      `${e.day} days`,
      Math.round(e.amount * 100),
      e.category,
      e.method ?? 'card',
      e.description ?? null,
      e.billable === false ? 0 : 1,
      `${e.day} days`,
    );
  }
}

function addEvent(jobId, kind, fromStatus, toStatus, body, dayOffset) {
  db.prepare(
    `INSERT INTO job_events (job_id, kind, from_status, to_status, body, author, created_at)
     VALUES (?, ?, ?, ?, ?, 'Mike', datetime('now', ?))`,
  ).run(jobId, kind, fromStatus, toStatus, body ?? null, `${dayOffset} days`);
}

const counts = db.prepare(
  `SELECT (SELECT COUNT(*) FROM clients) AS c, (SELECT COUNT(*) FROM jobs) AS j,
          (SELECT COUNT(*) FROM expenses) AS e, (SELECT COUNT(*) FROM vendors) AS v,
          (SELECT COUNT(*) FROM leads) AS l, (SELECT COUNT(*) FROM estimates) AS es,
          (SELECT COUNT(*) FROM invoices) AS i`,
).get();
console.log(`Seeded ${counts.c} clients, ${counts.j} jobs, ${counts.v} vendors, ${counts.e} expenses, `
  + `${counts.l} leads, ${counts.es} estimates and ${counts.i} invoices into ${dbFile}`);
console.log('No account is created by seeding. Start the server and set one up on first use.');
db.close();
