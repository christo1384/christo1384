// Phase 1 views: dashboard, jobs and clients.
import {
  api, get, esc, card, list, jobRow, pill, statusLabel, money, moneyShort,
  fmtDate, fmtWhen, daysSince, openForm, toast, attempt, refresh, state,
} from './ui.js';
import { renderJobMoney } from './views-money.js';
import { renderJobEstimates } from './views-estimates.js';
import { renderJobInvoices } from './views-invoices.js';
import { renderJobPhotos } from './views-photos.js';

/* ----------------------------- dashboard ----------------------------- */

export async function dashboardView() {
  const monthStart = new Date();
  monthStart.setDate(1);
  const from = monthStart.toISOString().slice(0, 10);

  const [d, spend] = await Promise.all([
    get('/api/dashboard'),
    get(`/api/reports/spend?from=${from}`),
  ]);

  const tiles = `<div class="tiles">
    <div class="card tile"><div class="n">${d.totals.pipeline}</div><div class="k">In the pipeline</div></div>
    <div class="card tile"><div class="n">${d.totals.active}</div><div class="k">Jobs underway</div></div>
    <div class="card tile${d.stale.length ? ' alert' : ''}"><div class="n">${d.stale.length}</div><div class="k">Needs attention</div></div>
    <div class="card tile${d.overdue.length ? ' alert' : ''}"><div class="n">${d.overdue.length}</div><div class="k">Past target date</div></div>
    <a class="card tile" href="#/reports"><div class="n">${moneyShort(spend.total_cents)}</div><div class="k">Spent this month</div></a>
  </div>`;

  const strip = `<div class="status-strip">${d.by_status.map((s) => (
    `<a href="#/jobs?status=${s.key}" class="pill s-${s.key}">${esc(s.label)}<span class="count">${s.count}</span></a>`
  )).join('')}</div>`;

  const staleCard = card(
    `Not touched in ${d.stale_after_days}+ days`,
    list(d.stale, (j) => jobRow(j, `${daysSince(j.last_activity_at) ?? '?'} days quiet`),
      'Everything open has been updated recently.'),
    { flush: true },
  );

  const upcomingCard = card(
    'Starting in the next two weeks',
    list(d.upcoming, (j) => jobRow(j, fmtDate(j.start_date)), 'Nothing scheduled to start yet.'),
    { flush: true },
  );

  const overdueCard = d.overdue.length
    ? card('Past target finish date',
        list(d.overdue, (j) => jobRow(j, `was due ${fmtDate(j.target_end_date)}`), ''), { flush: true })
    : '';

  const activityCard = card(
    'Recent activity',
    list(d.recent, (e) => `<li><a class="list-link" href="#/jobs/${e.job_id}">
      <span><span class="title">${esc(e.title)}</span><br>
      <span class="meta">${esc(e.summary)}${e.author ? ` &middot; ${esc(e.author)}` : ''}</span></span>
      <span class="right meta">${esc(fmtWhen(e.created_at))}</span></a></li>`, 'No activity yet.'),
    { flush: true },
  );

  document.getElementById('view').innerHTML = `
    <div class="page-head"><h1>Dashboard</h1><span class="muted">${d.totals.all} jobs on file</span></div>
    ${tiles}${strip}
    <div class="two-col">${staleCard}${upcomingCard}</div>
    ${overdueCard ? `<div class="stack" style="margin-top:16px">${overdueCard}</div>` : ''}
    <div class="stack" style="margin-top:16px">${activityCard}</div>`;
}

/* -------------------------------- jobs -------------------------------- */

export async function jobsView(params) {
  const status = params.get('status') || '';
  const group = params.get('group') || '';
  const search = params.get('search') || '';

  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (group) query.set('group', group);
  if (search) query.set('search', search);
  const jobs = await get(`/api/jobs?${query}`);

  const filter = (label, key, value) => {
    const active = (key === 'group' ? group : status) === value && (key === 'group' ? !status : !group);
    return `<a class="btn btn-sm${active ? ' btn-primary' : ''}" href="#/jobs?${key}=${value}">${esc(label)}</a>`;
  };
  const isAll = !status && !group;

  document.getElementById('view').innerHTML = `
    <div class="page-head"><h1>Jobs</h1><span class="muted">${jobs.length} shown</span></div>
    <div class="row" style="margin-bottom:12px">
      <a class="btn btn-sm${isAll ? ' btn-primary' : ''}" href="#/jobs">All</a>
      ${filter('Pipeline', 'group', 'pipeline')}
      ${filter('Underway', 'group', 'active')}
      ${filter('Closed', 'group', 'closed')}
      <input id="job-search" placeholder="Search title, job number, address, client"
             value="${esc(search)}" style="max-width:320px;margin-left:auto">
    </div>
    ${card('', list(jobs, (j) => jobRow(j, j.start_date ? `starts ${fmtDate(j.start_date)}` : ''),
      'No jobs match this filter.'), { flush: true })}
    <div class="row" style="margin-top:16px">
      <button class="btn btn-primary" id="new-job" type="button">New job</button>
    </div>`;

  document.getElementById('new-job').addEventListener('click', () => newJob());

  const input = document.getElementById('job-search');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const next = new URLSearchParams();
    if (input.value.trim()) next.set('search', input.value.trim());
    location.hash = `#/jobs${next.toString() ? `?${next}` : ''}`;
  });
}

export async function jobDetailView(id) {
  const job = await get(`/api/jobs/${id}`);

  const moves = job.allowed_next.map((s) => (
    `<button class="btn btn-sm" data-move="${s}">${esc(statusLabel(s))}</button>`
  )).join('');

  const facts = `<dl class="facts">
    <dt>Client</dt><dd>${job.client_id ? `<a href="#/clients/${job.client_id}">${esc(job.client_name)}</a>` : '—'}</dd>
    <dt>Phone</dt><dd>${job.client_phone ? `<a href="tel:${esc(job.client_phone)}">${esc(job.client_phone)}</a>` : '—'}</dd>
    <dt>Site</dt><dd>${esc(job.site_address || '—')}</dd>
    <dt>Priority</dt><dd>${esc(job.priority[0].toUpperCase() + job.priority.slice(1))}</dd>
    <dt>Start</dt><dd>${fmtDate(job.start_date)}</dd>
    <dt>Target finish</dt><dd>${fmtDate(job.target_end_date)}</dd>
    <dt>Last activity</dt><dd>${esc(fmtWhen(job.last_activity_at)) || '—'}</dd>
  </dl>
  ${job.description ? `<p style="margin:14px 0 0;white-space:pre-wrap">${esc(job.description)}</p>` : ''}`;

  const timeline = `<ul class="timeline">${job.events.map((e) => `<li>
    <span class="dot ${esc(e.kind)}"></span>
    <span>
      ${e.kind === 'status_change'
        ? `${pill(e.from_status)} → ${pill(e.to_status)}`
        : `<strong>${e.kind === 'created' ? 'Job created' : 'Note'}</strong>`}
      ${e.body ? `<div>${esc(e.body)}</div>` : ''}
      <div class="when">${esc(fmtWhen(e.created_at))}${e.author ? ` &middot; ${esc(e.author)}` : ''}</div>
    </span></li>`).join('')}</ul>`;

  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="page-head">
      <h1>${esc(job.title)}</h1>${pill(job.status)}
      <span class="muted">${esc(job.job_number || '')}</span>
    </div>
    <div class="detail-grid">
      <div class="stack">
        ${card('Move this job', `<div class="row">${moves || '<span class="muted">No moves available.</span>'}</div>`)}
        <section class="card" id="job-estimates"><div class="card-body muted">Loading estimates…</div></section>
        <section class="card" id="job-money"><div class="card-body muted">Loading money…</div></section>
        <section class="card" id="job-invoices"><div class="card-body muted">Loading invoices…</div></section>
        <section class="card" id="job-photos"><div class="card-body muted">Loading photos…</div></section>
        ${card('Timeline', timeline, {
          flush: true,
          actions: '<button class="btn btn-sm" id="add-note">Add note</button>',
        })}
      </div>
      <div class="stack">
        ${card('Details', facts, { actions: '<button class="btn btn-sm" id="edit-job">Edit</button>' })}
        ${card('', '<button class="btn btn-sm btn-danger" id="delete-job">Delete job</button>')}
      </div>
    </div>`;

  // Each panel loads on its own so one slow or failing section cannot blank
  // the page the crew is standing in front of.
  for (const [id, render] of [
    ['job-estimates', renderJobEstimates],
    ['job-money', renderJobMoney],
    ['job-invoices', renderJobInvoices],
    ['job-photos', renderJobPhotos],
  ]) {
    const panel = document.getElementById(id);
    render(panel, job.id).catch((err) => {
      panel.innerHTML = `<div class="card-body muted">${esc(err.message)}</div>`;
    });
  }

  view.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const to = btn.dataset.move;
      const form = await openForm({
        title: `Move to ${statusLabel(to)}`,
        submitLabel: 'Save move',
        fields: [{ name: 'note', label: 'Note (optional)', type: 'textarea' }],
      });
      if (!form) return;
      await attempt(() => api('POST', `/api/jobs/${job.id}/status`, { status: to, ...form }),
        `Moved to ${statusLabel(to)}`);
    });
  });

  document.getElementById('add-note').addEventListener('click', async () => {
    const form = await openForm({
      title: 'Add a note',
      submitLabel: 'Add note',
      fields: [{ name: 'body', label: 'Note', type: 'textarea', required: true }],
    });
    if (!form) return;
    await attempt(() => api('POST', `/api/jobs/${job.id}/events`, form), 'Note added');
  });

  document.getElementById('edit-job').addEventListener('click', async () => {
    const options = await clientOptions();
    const form = await openForm({
      title: 'Edit job',
      fields: jobFields(options, job),
      values: { ...job, client_id: job.client_id ?? '' },
    });
    if (!form) return;
    await attempt(() => api('PATCH', `/api/jobs/${job.id}`, form), 'Job updated');
  });

  document.getElementById('delete-job').addEventListener('click', async () => {
    if (!confirm(`Delete ${job.job_number} and its whole timeline? This cannot be undone.`)) return;
    await api('DELETE', `/api/jobs/${job.id}`);
    toast('Job deleted');
    location.hash = '#/jobs';
  });
}

async function clientOptions() {
  const clients = await get('/api/clients');
  return [{ value: '', label: '— No client —' }]
    .concat(clients.map((c) => ({ value: c.id, label: c.company ? `${c.name} (${c.company})` : c.name })));
}

function jobFields(options, values = {}) {
  return [
    { name: 'title', label: 'Job title', required: true },
    { name: 'client_id', label: 'Client', type: 'select', options },
    { name: 'site_address', label: 'Site address' },
    { name: 'priority', label: 'Priority', type: 'select', value: 'normal',
      options: state.meta.priorities.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })) },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'target_end_date', label: 'Target finish', type: 'date' },
    { name: 'description', label: 'Scope / notes', type: 'textarea' },
  ].map((f) => ({ ...f, value: values[f.name] ?? f.value }));
}

export async function newJob(presetClientId) {
  const options = await clientOptions();
  const form = await openForm({
    title: 'New job',
    submitLabel: 'Create job',
    fields: jobFields(options, presetClientId ? { client_id: presetClientId } : {}),
  });
  if (!form) return;
  try {
    const job = await api('POST', '/api/jobs', form);
    toast(`${job.job_number} created`);
    location.hash = `#/jobs/${job.id}`;
    refresh();
  } catch (err) {
    toast(err.message);
  }
}

/* ------------------------------ clients ------------------------------ */

export async function clientsView() {
  const clients = await get('/api/clients');
  document.getElementById('view').innerHTML = `
    <div class="page-head"><h1>Clients</h1>
      <button class="btn btn-primary btn-sm" id="new-client" style="margin-left:auto">New client</button></div>
    ${card('', list(clients, (c) => `<li><a class="list-link" href="#/clients/${c.id}">
      <span><span class="title">${esc(c.name)}</span>
        <br><span class="meta">${esc(c.company || c.phone || c.email || 'No contact details')}</span></span>
      <span class="right meta">${c.job_count} job${c.job_count === 1 ? '' : 's'}</span>
    </a></li>`, 'No clients yet.'), { flush: true })}`;

  document.getElementById('new-client').addEventListener('click', () => editClient());
}

export async function clientDetailView(id) {
  const client = await get(`/api/clients/${id}`);
  document.getElementById('view').innerHTML = `
    <div class="page-head"><h1>${esc(client.name)}</h1>
      <span class="muted">${esc(client.company || '')}</span></div>
    <div class="detail-grid">
      <div class="stack">${card('Jobs',
        list(client.jobs, (j) => jobRow(j, j.start_date ? `starts ${fmtDate(j.start_date)}` : ''),
          'No jobs for this client yet.'),
        { flush: true, actions: '<button class="btn btn-sm" id="add-job">New job</button>' })}</div>
      <div class="stack">${card('Contact', `<dl class="facts">
          <dt>Phone</dt><dd>${client.phone ? `<a href="tel:${esc(client.phone)}">${esc(client.phone)}</a>` : '—'}</dd>
          <dt>Email</dt><dd>${client.email ? `<a href="mailto:${esc(client.email)}">${esc(client.email)}</a>` : '—'}</dd>
          <dt>Address</dt><dd>${esc(client.address || '—')}</dd>
        </dl>${client.notes ? `<p style="margin:14px 0 0;white-space:pre-wrap">${esc(client.notes)}</p>` : ''}`,
        { actions: '<button class="btn btn-sm" id="edit-client">Edit</button>' })}
      </div>
    </div>`;

  document.getElementById('add-job').addEventListener('click', () => newJob(client.id));
  document.getElementById('edit-client').addEventListener('click', () => editClient(client));
}

async function editClient(existing) {
  const form = await openForm({
    title: existing ? 'Edit client' : 'New client',
    submitLabel: existing ? 'Save' : 'Create client',
    values: existing || {},
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'company', label: 'Company' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Mailing address' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  });
  if (!form) return;

  if (existing) {
    await attempt(() => api('PATCH', `/api/clients/${existing.id}`, form), 'Client updated');
    return;
  }
  try {
    const client = await api('POST', '/api/clients', form);
    toast('Client added');
    location.hash = `#/clients/${client.id}`;
    refresh();
  } catch (err) {
    toast(err.message);
  }
}
