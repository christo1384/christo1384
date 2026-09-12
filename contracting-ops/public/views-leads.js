// Phase 3: the lead inbox. Capture in seconds, convert in one button.
import {
  api, get, esc, card, list, fmtDate, titleCase, openForm, toast, attempt, refresh, today, state,
} from './ui.js';

const OPEN = ['new', 'contacted', 'qualified'];

export async function leadsView(params) {
  const filter = params.get('status') || 'open';
  const query = filter === 'all' ? '' : (filter === 'open' ? '?open=1' : `?status=${filter}`);
  const { counts, leads } = await get(`/api/leads${query}`);

  const chip = (label, value, count) => {
    const active = filter === value;
    return `<a class="btn btn-sm${active ? ' btn-primary' : ''}" href="#/leads?status=${value}">${esc(label)}${
      count === undefined ? '' : ` <span class="count">${count}</span>`}</a>`;
  };
  const openCount = OPEN.reduce((n, s) => n + (counts[s] ?? 0), 0);

  const row = (lead) => {
    const contact = [lead.phone, lead.email].filter(Boolean).join(' &middot; ') || 'No contact details';
    const outcome = lead.status === 'converted'
      ? `<a href="#/jobs/${lead.converted_job_id}">${esc(lead.job_number ?? 'job')}</a>`
      : (lead.status === 'lost' && lead.lost_reason ? esc(lead.lost_reason) : '');

    return `<li><div class="list-link" data-lead="${lead.id}">
      <span>
        <span class="title">${esc(lead.name)}</span>
        <span class="pill lead-${esc(lead.status)}">${esc(titleCase(lead.status))}</span>
        ${lead.source ? `<span class="pill cat">${esc(titleCase(lead.source))}</span>` : ''}
        <br><span class="meta">${fmtDate(lead.received_on)} &middot; ${contact}</span>
        ${lead.description ? `<br><span class="meta">${esc(lead.description)}</span>` : ''}
        ${outcome ? `<br><span class="meta">${outcome}</span>` : ''}
      </span>
      <span class="right">
        ${OPEN.includes(lead.status)
          ? `<button class="btn btn-sm btn-primary" data-convert="${lead.id}" type="button">Convert</button>
             <button class="btn btn-sm" data-edit="${lead.id}" type="button">Edit</button>`
          : `<button class="btn btn-sm" data-edit="${lead.id}" type="button">Edit</button>`}
      </span>
    </div></li>`;
  };

  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="page-head"><h1>Leads</h1>
      <span class="muted">${openCount} open</span></div>
    <div class="row" style="margin-bottom:12px">
      ${chip('Open', 'open', openCount)}
      ${chip('New', 'new', counts.new ?? 0)}
      ${chip('Contacted', 'contacted', counts.contacted ?? 0)}
      ${chip('Qualified', 'qualified', counts.qualified ?? 0)}
      ${chip('Converted', 'converted', counts.converted ?? 0)}
      ${chip('Lost', 'lost', counts.lost ?? 0)}
      ${chip('All', 'all')}
    </div>
    ${card('', list(leads, row, filter === 'open'
      ? 'No open leads. Everything that came in has been dealt with.'
      : 'Nothing here.'), { flush: true })}
    <div class="row" style="margin-top:16px">
      <button class="btn btn-primary" id="new-lead" type="button">Add lead</button>
    </div>`;

  const byId = new Map(leads.map((l) => [String(l.id), l]));
  view.querySelectorAll('[data-convert]').forEach((btn) => {
    btn.addEventListener('click', () => convertLead(byId.get(btn.dataset.convert)));
  });
  view.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => editLead(byId.get(btn.dataset.edit)));
  });
  document.getElementById('new-lead').addEventListener('click', () => newLead());
}

async function leadFields(values = {}) {
  const [campaigns, clients] = await Promise.all([
    get('/api/campaigns').catch(() => []),
    get('/api/clients').catch(() => []),
  ]);
  return [
    { name: 'name', label: 'Who called?', required: true, value: values.name ?? '' },
    { name: 'phone', label: 'Phone', type: 'tel', value: values.phone ?? '' },
    { name: 'email', label: 'Email', type: 'email', value: values.email ?? '' },
    { name: 'source', label: 'How did they find you?', type: 'select', value: values.source ?? '',
      options: [{ value: '', label: '—' }]
        .concat((state.meta.lead_sources ?? []).map((s) => ({ value: s, label: titleCase(s) }))) },
    { name: 'description', label: 'What do they want?', type: 'textarea', value: values.description ?? '' },
    { name: 'received_on', label: 'Date', type: 'date', value: values.received_on ?? today() },
    { name: 'referred_by_client_id', label: 'Who sent them?', type: 'select',
      value: values.referred_by_client_id ?? '',
      hint: 'The single most useful field here: it shows who keeps you booked.',
      options: [{ value: '', label: '\u2014 Nobody in particular \u2014' }]
        .concat(clients.map((c) => ({ value: c.id, label: c.name }))) },
    { name: 'campaign_id', label: 'Campaign', type: 'select', value: values.campaign_id ?? '',
      options: [{ value: '', label: '\u2014 None \u2014' }]
        .concat(campaigns.map((c) => ({ value: c.id, label: c.name }))) },
  ];
}

export async function newLead() {
  const form = await openForm({ title: 'New lead', submitLabel: 'Save lead', fields: await leadFields() });
  if (!form) return;
  await attempt(() => api('POST', '/api/leads', form), 'Lead saved');
}

async function editLead(lead) {
  const form = await openForm({
    title: 'Edit lead',
    fields: (await leadFields(lead)).concat([
      { name: 'status', label: 'Status', type: 'select', value: lead.status,
        options: (state.meta.lead_statuses ?? [])
          .filter((s) => s !== 'converted' || lead.status === 'converted')
          .map((s) => ({ value: s, label: titleCase(s) })) },
      { name: 'lost_reason', label: 'If lost, why?', value: lead.lost_reason ?? '' },
    ]),
  });
  if (!form) return;
  if (form.status === 'converted') delete form.status;   // conversion has its own endpoint
  await attempt(() => api('PATCH', `/api/leads/${lead.id}`, form), 'Lead updated');
}

async function convertLead(lead) {
  const clients = await get('/api/clients');
  const form = await openForm({
    title: `Convert ${lead.name}`,
    submitLabel: 'Create the job',
    fields: [
      { name: 'title', label: 'Job title', required: true, value: `${lead.name} — ${lead.description || 'work'}`.slice(0, 90) },
      { name: 'client_id', label: 'Client', type: 'select', value: '',
        hint: 'Leave as new to create a client from this lead’s details.',
        options: [{ value: '', label: `— New client: ${lead.name} —` }]
          .concat(clients.map((c) => ({ value: c.id, label: c.company ? `${c.name} (${c.company})` : c.name }))) },
      { name: 'site_address', label: 'Site address' },
      { name: 'start_date', label: 'Expected start', type: 'date' },
    ],
  });
  if (!form) return;

  try {
    const result = await api('POST', `/api/leads/${lead.id}/convert`, form);
    toast(`${result.job.job_number} created`);
    location.hash = `#/jobs/${result.job.id}`;
    refresh();
  } catch (err) {
    toast(err.message);
  }
}
