// Phase 3: invoicing. Status is derived from the payments, never set by hand.
import {
  api, get, esc, card, list, money, moneyShort, fmtDate, titleCase,
  openForm, toast, attempt, refresh, today, state,
} from './ui.js';

const statusPill = (status) => `<span class="pill inv-${esc(status)}">${esc(titleCase(status))}</span>`;

const invoiceRow = (inv, { showJob = true } = {}) => `<li><a class="list-link" href="#/invoices/${inv.id}">
  <span>
    <span class="title">${esc(inv.invoice_number)}</span> ${statusPill(inv.status)}
    ${inv.days_overdue > 0 ? `<span class="pill overdue">${inv.days_overdue} days late</span>` : ''}
    <br><span class="meta">${[
      showJob && inv.job_number ? esc(`${inv.job_number} ${inv.job_title ?? ''}`.trim()) : '',
      inv.client_name ? esc(inv.client_name) : '',
      inv.due_on ? `due ${fmtDate(inv.due_on)}` : 'not sent yet',
    ].filter(Boolean).join(' &middot; ')}</span>
  </span>
  <span class="right">
    <strong>${money(inv.total_cents)}</strong>
    ${inv.balance_cents !== inv.total_cents
      ? `<br><span class="meta">${money(inv.balance_cents)} owing</span>` : ''}
  </span>
</a></li>`;

/* --------------------------- card on a job --------------------------- */

export async function renderJobInvoices(container, jobId) {
  const invoices = await get(`/api/jobs/${jobId}/invoices`);
  const owed = invoices.filter((i) => i.status !== 'void').reduce((n, i) => n + i.balance_cents, 0);

  container.innerHTML = `
    <div class="card-head">
      <h2>Invoices</h2>
      ${owed > 0 ? `<span class="meta">${money(owed)} owing</span>` : ''}
      <div class="row" style="margin-left:auto">
        <button class="btn btn-sm btn-primary" id="new-invoice" type="button">New invoice</button>
      </div>
    </div>
    ${list(invoices, (i) => invoiceRow(i, { showJob: false }), 'Nothing invoiced yet.')}`;

  document.getElementById('new-invoice').addEventListener('click', () => createInvoice(jobId));
}

async function createInvoice(jobId) {
  const form = await openForm({
    title: 'New invoice',
    submitLabel: 'Create',
    fields: [
      { name: 'from', label: 'Start from', type: 'select', value: 'estimate',
        options: [
          { value: 'estimate', label: 'The accepted estimate' },
          { value: 'expenses', label: 'Billable expenses on this job' },
          { value: 'empty', label: 'An empty invoice' },
        ] },
      { name: 'notes', label: 'Notes on the invoice', type: 'textarea' },
    ],
  });
  if (!form) return;

  try {
    const invoice = await api('POST', `/api/jobs/${jobId}/invoices`, form);
    toast(`${invoice.invoice_number} created`);
    location.hash = `#/invoices/${invoice.id}`;
    refresh();
  } catch (err) {
    toast(err.message);
  }
}

/* ------------------------------ the list ------------------------------ */

export async function invoicesView(params) {
  const filter = params.get('status') || 'outstanding';
  const { totals, invoices } = await get(`/api/invoices${filter === 'all' ? '' : `?status=${filter}`}`);

  const chip = (label, value) => `<a class="btn btn-sm${filter === value ? ' btn-primary' : ''}"
    href="#/money?tab=invoices&status=${value}">${esc(label)}</a>`;

  return `
    <div class="row" style="margin-bottom:12px">
      ${chip('Outstanding', 'outstanding')}${chip('Overdue', 'overdue')}
      ${chip('Draft', 'draft')}${chip('Paid', 'paid')}${chip('All', 'all')}
    </div>
    <div class="tiles">
      <div class="card tile"><div class="n">${moneyShort(totals.invoiced_cents)}</div><div class="k">Invoiced</div></div>
      <div class="card tile"><div class="n">${moneyShort(totals.paid_cents)}</div><div class="k">Paid</div></div>
      <div class="card tile${totals.outstanding_cents > 0 ? ' alert' : ''}">
        <div class="n">${moneyShort(totals.outstanding_cents)}</div><div class="k">Still owed</div></div>
    </div>
    ${card('', list(invoices, (i) => invoiceRow(i), filter === 'outstanding'
      ? 'Nothing outstanding. Everything invoiced has been paid.'
      : 'No invoices here.'), { flush: true })}`;
}

/* ----------------------------- the invoice ---------------------------- */

export async function invoiceView(id) {
  const invoice = await get(`/api/invoices/${id}`);
  const open = invoice.status !== 'void' && invoice.paid_cents === 0;
  const issued = Boolean(invoice.issued_on);

  const lineRow = (l) => `<tr>
    <td>${esc(l.description)}</td>
    <td class="num">${l.quantity}</td>
    <td class="num">${money(l.unit_price_cents)}</td>
    <td class="num"><strong>${money(l.line_total_cents)}</strong></td>
    ${open ? `<td class="num">
      <button class="btn btn-sm" data-line-edit="${l.id}" type="button">Edit</button>
      <button class="btn btn-sm btn-danger" data-line-delete="${l.id}" type="button">&times;</button>
    </td>` : ''}
  </tr>`;

  const linesTable = invoice.lines.length
    ? `<table class="table lines">
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th>
          <th class="num">Total</th>${open ? '<th></th>' : ''}</tr></thead>
        <tbody>${invoice.lines.map(lineRow).join('')}</tbody>
      </table>`
    : '<p class="empty">No lines yet.</p>';

  const paymentsList = list(invoice.payments, (p) => `<li><div class="list-link">
    <span><span class="title">${money(p.amount_cents)}</span>
      <br><span class="meta">${fmtDate(p.received_on)}${p.method ? ` &middot; ${esc(p.method.toUpperCase())}` : ''}${
        p.reference ? ` &middot; ${esc(p.reference)}` : ''}</span></span>
    <span class="right"><button class="btn btn-sm btn-danger" data-payment="${p.id}" type="button">Remove</button></span>
  </div></li>`, 'No payments recorded.');

  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="page-head">
      <h1>${esc(invoice.invoice_number)}</h1>${statusPill(invoice.status)}
      ${invoice.days_overdue > 0 ? `<span class="pill overdue">${invoice.days_overdue} days late</span>` : ''}
      <span class="muted"><a href="#/jobs/${invoice.job_id}">${esc(invoice.job_number)} ${esc(invoice.job_title)}</a></span>
    </div>
    <div class="detail-grid">
      <div class="stack">
        ${card('Lines', linesTable, { flush: true, actions: open
          ? '<button class="btn btn-sm btn-primary" id="add-line" type="button">Add line</button>' : '' })}
        ${card('Payments', paymentsList, { flush: true, actions: issued && invoice.status !== 'void'
          && invoice.balance_cents > 0
          ? '<button class="btn btn-sm btn-primary" id="add-payment" type="button">Record payment</button>' : '' })}
      </div>
      <div class="stack">
        ${card('Total', `
          <div class="totals">
            <div><span>Invoiced</span><span>${money(invoice.total_cents)}</span></div>
            <div><span>Paid</span><span>${money(invoice.paid_cents)}</span></div>
            <div class="grand"><span>Owing</span><span>${money(invoice.balance_cents)}</span></div>
          </div>
          <dl class="facts" style="margin-top:14px">
            <dt>Client</dt><dd>${esc(invoice.client_name ?? '—')}</dd>
            <dt>Issued</dt><dd>${fmtDate(invoice.issued_on)}</dd>
            <dt>Due</dt><dd>${fmtDate(invoice.due_on)}</dd>
          </dl>
          ${invoice.notes ? `<p style="margin:12px 0 0;white-space:pre-wrap">${esc(invoice.notes)}</p>` : ''}`,
          { actions: invoice.status !== 'void'
            ? '<button class="btn btn-sm" id="edit-invoice" type="button">Edit</button>' : '' })}
        ${card('', `<div class="row">
          ${!issued && invoice.status !== 'void'
            ? '<button class="btn btn-primary" id="send-invoice" type="button">Mark as sent</button>' : ''}
          ${invoice.paid_cents === 0 && invoice.status !== 'void'
            ? '<button class="btn btn-danger" id="void-invoice" type="button">Void</button>' : ''}
          ${!issued ? '<button class="btn btn-sm btn-danger" id="delete-invoice" type="button">Delete draft</button>' : ''}
        </div>`)}
      </div>
    </div>`;

  if (open) {
    document.getElementById('add-line').addEventListener('click', () => editInvoiceLine(invoice.id));
    view.querySelectorAll('[data-line-edit]').forEach((btn) => {
      const line = invoice.lines.find((l) => String(l.id) === btn.dataset.lineEdit);
      btn.addEventListener('click', () => editInvoiceLine(invoice.id, line));
    });
    view.querySelectorAll('[data-line-delete]').forEach((btn) => {
      btn.addEventListener('click', () => attempt(
        () => api('DELETE', `/api/invoice-lines/${btn.dataset.lineDelete}`), 'Line removed',
      ));
    });
  }

  view.querySelectorAll('[data-payment]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this payment? The invoice status will follow.')) return;
      await attempt(() => api('DELETE', `/api/payments/${btn.dataset.payment}`), 'Payment removed');
    });
  });

  document.getElementById('add-payment')?.addEventListener('click', async () => {
    const form = await openForm({
      title: 'Record a payment',
      submitLabel: 'Record it',
      fields: [
        { name: 'amount', label: 'Amount', inputmode: 'decimal', required: true,
          value: (invoice.balance_cents / 100).toFixed(2),
          hint: `${money(invoice.balance_cents)} is still owing.` },
        { name: 'received_on', label: 'Received', type: 'date', value: today(), required: true },
        { name: 'method', label: 'How', type: 'select', value: 'check',
          options: [{ value: '', label: '—' }]
            .concat((state.meta.payment_methods ?? []).map((m) => ({ value: m, label: m.toUpperCase() }))) },
        { name: 'reference', label: 'Check number or reference' },
      ],
    });
    if (!form) return;
    await attempt(() => api('POST', `/api/invoices/${invoice.id}/payments`, form), 'Payment recorded');
  });

  document.getElementById('send-invoice')?.addEventListener('click', async () => {
    const form = await openForm({
      title: 'Mark as sent',
      submitLabel: 'Mark as sent',
      fields: [
        { name: 'issued_on', label: 'Issued', type: 'date', value: today(), required: true },
        { name: 'due_on', label: 'Due', type: 'date', hint: 'Leave blank for 14 day terms.' },
      ],
    });
    if (!form) return;
    await attempt(() => api('POST', `/api/invoices/${invoice.id}/send`, form), 'Invoice issued');
  });

  document.getElementById('void-invoice')?.addEventListener('click', async () => {
    if (!confirm(`Void ${invoice.invoice_number}? It stays on the record but stops counting as owed.`)) return;
    await attempt(() => api('POST', `/api/invoices/${invoice.id}/void`, {}), 'Invoice voided');
  });

  document.getElementById('delete-invoice')?.addEventListener('click', async () => {
    if (!confirm('Delete this draft invoice?')) return;
    try {
      await api('DELETE', `/api/invoices/${invoice.id}`);
      toast('Draft deleted');
      location.hash = `#/jobs/${invoice.job_id}`;
    } catch (err) { toast(err.message); }
  });

  document.getElementById('edit-invoice')?.addEventListener('click', async () => {
    const form = await openForm({
      title: 'Invoice details',
      fields: [
        { name: 'issued_on', label: 'Issued', type: 'date', value: invoice.issued_on ?? '' },
        { name: 'due_on', label: 'Due', type: 'date', value: invoice.due_on ?? '' },
        { name: 'notes', label: 'Notes', type: 'textarea', value: invoice.notes ?? '' },
      ],
    });
    if (!form) return;
    await attempt(() => api('PATCH', `/api/invoices/${invoice.id}`, form), 'Invoice updated');
  });
}

async function editInvoiceLine(invoiceId, line) {
  const form = await openForm({
    title: line ? 'Edit line' : 'Add line',
    submitLabel: line ? 'Save' : 'Add',
    fields: [
      { name: 'description', label: 'Description', required: true, value: line?.description ?? '' },
      { name: 'quantity', label: 'Quantity', inputmode: 'decimal', value: String(line?.quantity ?? 1) },
      { name: 'unit_price', label: 'Price each', inputmode: 'decimal', required: true,
        value: line ? (line.unit_price_cents / 100).toFixed(2) : '' },
    ],
  });
  if (!form) return;
  await attempt(() => (line
    ? api('PATCH', `/api/invoice-lines/${line.id}`, form)
    : api('POST', `/api/invoices/${invoiceId}/lines`, form)), line ? 'Line updated' : 'Line added');
}
