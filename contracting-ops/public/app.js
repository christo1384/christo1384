// Contracting Ops - phase 1 client. No build step, no framework.

const view = document.getElementById('view');
const modal = document.getElementById('modal');
let meta = { statuses: [], priorities: [], stale_days: 7 };

/* ------------------------------ api ------------------------------ */

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const get = (p) => api('GET', p);

/* ---------------------------- helpers ---------------------------- */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const statusLabel = (key) => meta.statuses.find((s) => s.key === key)?.label ?? key;
const pill = (status) => `<span class="pill s-${esc(status)}">${esc(statusLabel(status))}</span>`;

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(+d) ? value : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** SQLite stores UTC without a zone marker; make it explicit before parsing. */
function fmtWhen(value) {
  if (!value) return '';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(+d)) return value;
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days === 0) return `today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysSince(value) {
  if (!value) return null;
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(+d) ? null : Math.floor((Date.now() - d) / 86400000);
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}

function card(title, bodyHtml, { actions = '', flush = false } = {}) {
  return `<section class="card">
    ${title ? `<div class="card-head"><h2>${esc(title)}</h2>${actions ? `<div class="row" style="margin-left:auto">${actions}</div>` : ''}</div>` : ''}
    ${flush ? bodyHtml : `<div class="card-body">${bodyHtml}</div>`}
  </section>`;
}

function jobRow(job, extraRight = '') {
  const client = job.client_name ? esc(job.client_name) : 'No client on file';
  return `<li><a class="list-link" href="#/jobs/${job.id}">
    <span>
      <span class="title">${esc(job.title)}</span>
      ${job.priority === 'high' ? ' <span class="pill prio-high">High</span>' : ''}
      <br><span class="meta">${esc(job.job_number || '')} &middot; ${client}</span>
    </span>
    <span class="right">${pill(job.status)}${extraRight ? `<br><span class="meta">${extraRight}</span>` : ''}</span>
  </a></li>`;
}

function list(items, renderItem, emptyText) {
  if (!items.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return `<ul class="list">${items.map(renderItem).join('')}</ul>`;
}

/* ----------------------------- modal ----------------------------- */

/**
 * Renders a form in the dialog and resolves with the field values, or null
 * when the user cancels. `fields` is a list of { name, label, type, ... }.
 */
function openForm({ title, fields, submitLabel = 'Save', values = {} }) {
  const fieldsEl = document.getElementById('modal-fields');
  const errorEl = document.getElementById('modal-error');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-save').textContent = submitLabel;
  errorEl.hidden = true;

  fieldsEl.innerHTML = fields.map((f) => {
    const value = values[f.name] ?? f.value ?? '';
    const common = `id="f-${f.name}" name="${f.name}"`;
    let input;
    if (f.type === 'textarea') input = `<textarea ${common} rows="3">${esc(value)}</textarea>`;
    else if (f.type === 'select') {
      input = `<select ${common}>${f.options.map((o) => (
        `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`
      )).join('')}</select>`;
    } else input = `<input ${common} type="${f.type || 'text'}" value="${esc(value)}">`;
    return `<div class="field"><label for="f-${f.name}">${esc(f.label)}</label>${input}</div>`;
  }).join('');

  modal.showModal();
  fieldsEl.querySelector('input, select, textarea')?.focus();

  return new Promise((resolve) => {
    const save = document.getElementById('modal-save');
    const finish = (result) => {
      save.removeEventListener('click', onSave);
      modal.removeEventListener('close', onClose);
      resolve(result);
    };
    const onSave = () => {
      const out = {};
      for (const f of fields) out[f.name] = fieldsEl.querySelector(`[name="${f.name}"]`).value.trim();
      const missing = fields.find((f) => f.required && !out[f.name]);
      if (missing) {
        errorEl.textContent = `${missing.label} is required.`;
        errorEl.hidden = false;
        return;
      }
      modal.close();
      finish(out);
    };
    const onClose = () => finish(null);
    save.addEventListener('click', onSave);
    modal.addEventListener('close', onClose);
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
      options: meta.priorities.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })) },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'target_end_date', label: 'Target finish', type: 'date' },
    { name: 'description', label: 'Scope / notes', type: 'textarea' },
  ].map((f) => ({ ...f, value: values[f.name] ?? f.value }));
}

async function newJob(presetClientId) {
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
    render();
  } catch (err) { toast(err.message); }
}

/* ----------------------------- views ----------------------------- */

async function dashboardView() {
  const d = await get('/api/dashboard');

  const tiles = `<div class="tiles">
    <div class="card tile"><div class="n">${d.totals.pipeline}</div><div class="k">In the pipeline</div></div>
    <div class="card tile"><div class="n">${d.totals.active}</div><div class="k">Jobs underway</div></div>
    <div class="card tile${d.stale.length ? ' alert' : ''}"><div class="n">${d.stale.length}</div><div class="k">Needs attention</div></div>
    <div class="card tile${d.overdue.length ? ' alert' : ''}"><div class="n">${d.overdue.length}</div><div class="k">Past target date</div></div>
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

  view.innerHTML = `
    <div class="page-head"><h1>Dashboard</h1><span class="muted">${d.totals.all} jobs on file</span></div>
    ${tiles}${strip}
    <div class="two-col">${staleCard}${upcomingCard}</div>
    ${overdueCard ? `<div class="stack" style="margin-top:16px">${overdueCard}</div>` : ''}
    <div class="stack" style="margin-top:16px">${activityCard}</div>`;
}

async function jobsView(params) {
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
    const href = value ? `#/jobs?${key}=${value}` : '#/jobs';
    return `<a class="btn btn-sm${active ? ' btn-primary' : ''}" href="${href}">${esc(label)}</a>`;
  };
  const isAll = !status && !group;

  view.innerHTML = `
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
      'No jobs match this filter.'), { flush: true })}`;

  const input = document.getElementById('job-search');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const next = new URLSearchParams();
    if (input.value.trim()) next.set('search', input.value.trim());
    location.hash = `#/jobs${next.toString() ? `?${next}` : ''}`;
  });
}

async function jobDetailView(id) {
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

  view.innerHTML = `
    <div class="page-head">
      <h1>${esc(job.title)}</h1>${pill(job.status)}
      <span class="muted">${esc(job.job_number || '')}</span>
    </div>
    <div class="detail-grid">
      <div class="stack">
        ${card('Move this job', `<div class="row">${moves || '<span class="muted">No moves available.</span>'}</div>`)}
        ${card('Timeline', timeline, {
          flush: true,
          actions: '<button class="btn btn-sm" id="add-note">Add note</button>',
        })}
      </div>
      <div class="stack">
        ${card('Details', facts, { actions: '<button class="btn btn-sm" id="edit-job">Edit</button>' })}
        ${card('', `<button class="btn btn-sm btn-danger" id="delete-job">Delete job</button>`)}
      </div>
    </div>`;

  view.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const to = btn.dataset.move;
      const form = await openForm({
        title: `Move to ${statusLabel(to)}`,
        submitLabel: 'Save move',
        fields: [
          { name: 'note', label: 'Note (optional)', type: 'textarea' },
          { name: 'author', label: 'Who is logging this?' },
        ],
      });
      if (!form) return;
      try {
        await api('POST', `/api/jobs/${job.id}/status`, { status: to, ...form });
        toast(`Moved to ${statusLabel(to)}`);
        render();
      } catch (err) { toast(err.message); }
    });
  });

  document.getElementById('add-note').addEventListener('click', async () => {
    const form = await openForm({
      title: 'Add a note',
      submitLabel: 'Add note',
      fields: [
        { name: 'body', label: 'Note', type: 'textarea', required: true },
        { name: 'author', label: 'Who is logging this?' },
      ],
    });
    if (!form) return;
    try {
      await api('POST', `/api/jobs/${job.id}/events`, form);
      toast('Note added');
      render();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('edit-job').addEventListener('click', async () => {
    const options = await clientOptions();
    const form = await openForm({
      title: 'Edit job',
      fields: jobFields(options, job),
      values: { ...job, client_id: job.client_id ?? '' },
    });
    if (!form) return;
    try {
      await api('PATCH', `/api/jobs/${job.id}`, form);
      toast('Job updated');
      render();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('delete-job').addEventListener('click', async () => {
    if (!confirm(`Delete ${job.job_number} and its whole timeline? This cannot be undone.`)) return;
    await api('DELETE', `/api/jobs/${job.id}`);
    toast('Job deleted');
    location.hash = '#/jobs';
  });
}

async function clientsView() {
  const clients = await get('/api/clients');
  view.innerHTML = `
    <div class="page-head"><h1>Clients</h1>
      <button class="btn btn-primary btn-sm" id="new-client" style="margin-left:auto">New client</button></div>
    ${card('', list(clients, (c) => `<li><a class="list-link" href="#/clients/${c.id}">
      <span><span class="title">${esc(c.name)}</span>
        <br><span class="meta">${esc(c.company || c.phone || c.email || 'No contact details')}</span></span>
      <span class="right meta">${c.job_count} job${c.job_count === 1 ? '' : 's'}</span>
    </a></li>`, 'No clients yet.'), { flush: true })}`;

  document.getElementById('new-client').addEventListener('click', () => editClient());
}

async function clientDetailView(id) {
  const client = await get(`/api/clients/${id}`);
  view.innerHTML = `
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
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'address', label: 'Mailing address' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  });
  if (!form) return;
  try {
    if (existing) {
      await api('PATCH', `/api/clients/${existing.id}`, form);
      toast('Client updated');
      render();
    } else {
      const client = await api('POST', '/api/clients', form);
      toast('Client added');
      location.hash = `#/clients/${client.id}`;
      render();
    }
  } catch (err) { toast(err.message); }
}

/* ---------------------------- routing ---------------------------- */

const ROUTES = [
  [/^\/dashboard$/, 'dashboard', () => dashboardView()],
  [/^\/jobs$/, 'jobs', (m, params) => jobsView(params)],
  [/^\/jobs\/(\d+)$/, 'jobs', (m) => jobDetailView(m[1])],
  [/^\/clients$/, 'clients', () => clientsView()],
  [/^\/clients\/(\d+)$/, 'clients', (m) => clientDetailView(m[1])],
];

async function render() {
  const raw = location.hash.slice(1) || '/dashboard';
  const [path, queryString = ''] = raw.split('?');
  const params = new URLSearchParams(queryString);

  const route = ROUTES.find(([pattern]) => pattern.test(path));
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === (route?.[1] ?? ''));
  });

  if (!route) {
    view.innerHTML = `<div class="page-head"><h1>Page not found</h1></div>
      <p class="muted"><a href="#/dashboard">Back to the dashboard</a></p>`;
    return;
  }

  try {
    await route[2](path.match(route[0]), params);
  } catch (err) {
    view.innerHTML = `<div class="page-head"><h1>Something went wrong</h1></div>
      <p class="muted">${esc(err.message)}</p>`;
  }
}

document.getElementById('new-job-btn').addEventListener('click', () => newJob());
window.addEventListener('hashchange', render);

get('/api/meta')
  .then((m) => { meta = m; })
  .catch(() => {})
  .finally(render);
