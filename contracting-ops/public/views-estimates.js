// Phase 3: the estimate builder. A sent estimate is never edited - revising
// one creates the next version, so there is always a record of what was shown.
import {
  api, get, esc, card, list, money, fmtDate, fmtWhen, titleCase,
  openForm, toast, attempt, refresh, state,
} from './ui.js';

const statusPill = (status) => `<span class="pill est-${esc(status)}">${esc(titleCase(status))}</span>`;

/* --------------------------- card on a job --------------------------- */

export async function renderJobEstimates(container, jobId) {
  const estimates = await get(`/api/jobs/${jobId}/estimates`);
  const latest = estimates[0];

  const row = (e) => `<li><a class="list-link" href="#/estimates/${e.id}">
    <span>
      <span class="title">Version ${e.version}</span> ${statusPill(e.status)}
      <br><span class="meta">${e.lines.length} line${e.lines.length === 1 ? '' : 's'}${
        e.sent_at ? ` &middot; sent ${fmtWhen(e.sent_at)}` : ''}</span>
    </span>
    <span class="right"><strong>${money(e.total_cents)}</strong></span>
  </a></li>`;

  container.innerHTML = `
    <div class="card-head">
      <h2>Estimates</h2>
      <div class="row" style="margin-left:auto">
        ${latest ? '<button class="btn btn-sm" id="revise-estimate" type="button">New version</button>' : ''}
        <button class="btn btn-sm${latest ? '' : ' btn-primary'}" id="new-estimate" type="button">
          ${latest ? 'Blank estimate' : 'Start an estimate'}</button>
      </div>
    </div>
    ${list(estimates, row, 'No estimate yet. Price the job here and it becomes the contract amount when accepted.')}`;

  document.getElementById('new-estimate').addEventListener('click', () => createEstimate(jobId));
  document.getElementById('revise-estimate')?.addEventListener('click', () => createEstimate(jobId, latest));
}

async function createEstimate(jobId, copyFrom) {
  const form = await openForm({
    title: copyFrom ? `New version from v${copyFrom.version}` : 'New estimate',
    submitLabel: 'Create',
    fields: [
      { name: 'markup_percent', label: 'Markup %', inputmode: 'decimal',
        value: String(copyFrom?.markup_percent ?? 15),
        hint: 'Overhead and profit on top of the line costs.' },
      { name: 'valid_until', label: 'Good until', type: 'date' },
      { name: 'notes', label: 'Notes for the customer', type: 'textarea' },
    ],
  });
  if (!form) return;

  try {
    const estimate = await api('POST', `/api/jobs/${jobId}/estimates`, {
      ...form,
      copy_from_estimate_id: copyFrom?.id,
    });
    toast(`Version ${estimate.version} created`);
    location.hash = `#/estimates/${estimate.id}`;
    refresh();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------------------- builder page ---------------------------- */

export async function estimateView(id) {
  const estimate = await get(`/api/estimates/${id}`);
  const job = await get(`/api/jobs/${estimate.job_id}`);
  const editable = estimate.editable;

  const lineRow = (l) => `<tr>
    <td>${esc(l.description)}${l.category ? `<br><span class="meta">${esc(l.category)}</span>` : ''}</td>
    <td class="num">${l.quantity}${l.unit ? ` ${esc(l.unit)}` : ''}</td>
    <td class="num">${money(l.unit_cost_cents)}</td>
    <td class="num"><strong>${money(l.line_total_cents)}</strong></td>
    ${editable ? `<td class="num">
      <button class="btn btn-sm" data-line-edit="${l.id}" type="button">Edit</button>
      <button class="btn btn-sm btn-danger" data-line-delete="${l.id}" type="button">&times;</button>
    </td>` : ''}
  </tr>`;

  const linesTable = estimate.lines.length
    ? `<table class="table lines">
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th>
          <th class="num">Total</th>${editable ? '<th></th>' : ''}</tr></thead>
        <tbody>${estimate.lines.map(lineRow).join('')}</tbody>
      </table>`
    : '<p class="empty">No lines yet. Add the first one below.</p>';

  const actions = editable
    ? '<button class="btn btn-primary" id="send-estimate" type="button">Mark as sent</button>'
    : (estimate.status === 'sent'
      ? `<button class="btn btn-primary" id="accept-estimate" type="button">Customer accepted</button>
         <button class="btn" id="decline-estimate" type="button">Customer declined</button>`
      : '');

  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="page-head">
      <h1>Estimate v${estimate.version}</h1>${statusPill(estimate.status)}
      <span class="muted"><a href="#/jobs/${job.id}">${esc(job.job_number)} ${esc(job.title)}</a></span>
    </div>
    ${editable ? '' : `<p class="notice">This version has been ${esc(estimate.status)} and is locked.
      Use <strong>New version</strong> on the job to revise it.</p>`}
    <div class="detail-grid">
      <div class="stack">
        ${card('Lines', linesTable, { flush: true, actions: editable
          ? '<button class="btn btn-sm btn-primary" id="add-line" type="button">Add line</button>' : '' })}
        ${actions ? card('', `<div class="row">${actions}</div>`) : ''}
      </div>
      <div class="stack">
        ${card('Total', `
          <div class="totals">
            <div><span>Subtotal</span><span>${money(estimate.subtotal_cents)}</span></div>
            <div><span>Markup ${estimate.markup_percent}%</span><span>${money(estimate.markup_cents)}</span></div>
            <div class="grand"><span>Total</span><span>${money(estimate.total_cents)}</span></div>
          </div>
          <dl class="facts" style="margin-top:14px">
            <dt>Good until</dt><dd>${fmtDate(estimate.valid_until)}</dd>
            <dt>Sent</dt><dd>${estimate.sent_at ? fmtWhen(estimate.sent_at) : '—'}</dd>
            <dt>Decided</dt><dd>${estimate.decided_at ? fmtWhen(estimate.decided_at) : '—'}</dd>
          </dl>
          ${estimate.notes ? `<p style="margin:12px 0 0;white-space:pre-wrap">${esc(estimate.notes)}</p>` : ''}`,
          { actions: editable ? '<button class="btn btn-sm" id="edit-terms" type="button">Edit</button>' : '' })}
        ${editable && estimate.status === 'draft'
          ? card('', '<button class="btn btn-sm btn-danger" id="delete-estimate" type="button">Delete this draft</button>')
          : ''}
      </div>
    </div>`;

  if (editable) {
    document.getElementById('add-line').addEventListener('click', () => editLine(estimate.id));
    document.getElementById('edit-terms').addEventListener('click', () => editTerms(estimate));
    view.querySelectorAll('[data-line-edit]').forEach((btn) => {
      const line = estimate.lines.find((l) => String(l.id) === btn.dataset.lineEdit);
      btn.addEventListener('click', () => editLine(estimate.id, line));
    });
    view.querySelectorAll('[data-line-delete]').forEach((btn) => {
      btn.addEventListener('click', () => attempt(
        () => api('DELETE', `/api/estimate-lines/${btn.dataset.lineDelete}`), 'Line removed',
      ));
    });
    document.getElementById('delete-estimate')?.addEventListener('click', async () => {
      if (!confirm('Delete this draft estimate?')) return;
      await api('DELETE', `/api/estimates/${estimate.id}`);
      toast('Draft deleted');
      location.hash = `#/jobs/${estimate.job_id}`;
    });
    document.getElementById('send-estimate').addEventListener('click', async () => {
      if (!estimate.lines.length) { toast('Add at least one line first'); return; }
      if (!confirm(`Mark version ${estimate.version} as sent? It cannot be edited afterwards.`)) return;
      await attempt(() => api('POST', `/api/estimates/${estimate.id}/send`, {}), 'Marked as sent');
    });
  }

  document.getElementById('accept-estimate')?.addEventListener('click', async () => {
    if (!confirm(`Accept ${money(estimate.total_cents)}? This becomes the job's contract amount.`)) return;
    await attempt(() => api('POST', `/api/estimates/${estimate.id}/accept`, {}), 'Accepted, job scheduled');
  });

  document.getElementById('decline-estimate')?.addEventListener('click', async () => {
    const form = await openForm({
      title: 'Customer declined',
      submitLabel: 'Record it',
      fields: [{ name: 'reason', label: 'Why, if they said?', type: 'textarea' }],
    });
    if (!form) return;
    await attempt(() => api('POST', `/api/estimates/${estimate.id}/decline`, form), 'Recorded');
  });
}

async function editLine(estimateId, line) {
  const form = await openForm({
    title: line ? 'Edit line' : 'Add line',
    submitLabel: line ? 'Save' : 'Add',
    fields: [
      { name: 'description', label: 'Description', required: true, value: line?.description ?? '' },
      { name: 'quantity', label: 'Quantity', inputmode: 'decimal', value: String(line?.quantity ?? 1) },
      { name: 'unit', label: 'Unit', type: 'select', value: line?.unit ?? '',
        options: [{ value: '', label: '—' }]
          .concat((state.meta.units ?? []).map((u) => ({ value: u, label: u }))) },
      { name: 'unit_cost', label: 'Cost each', inputmode: 'decimal', required: true,
        value: line ? (line.unit_cost_cents / 100).toFixed(2) : '' },
      { name: 'category', label: 'Category', value: line?.category ?? '',
        hint: 'Optional: materials, labor, subcontractor…' },
    ],
  });
  if (!form) return;

  await attempt(() => (line
    ? api('PATCH', `/api/estimate-lines/${line.id}`, form)
    : api('POST', `/api/estimates/${estimateId}/lines`, form)), line ? 'Line updated' : 'Line added');
}

async function editTerms(estimate) {
  const form = await openForm({
    title: 'Estimate terms',
    fields: [
      { name: 'markup_percent', label: 'Markup %', inputmode: 'decimal', value: String(estimate.markup_percent) },
      { name: 'valid_until', label: 'Good until', type: 'date', value: estimate.valid_until ?? '' },
      { name: 'notes', label: 'Notes for the customer', type: 'textarea', value: estimate.notes ?? '' },
    ],
  });
  if (!form) return;
  await attempt(() => api('PATCH', `/api/estimates/${estimate.id}`, form), 'Estimate updated');
}
