// Phase 2 views: expenses, receipts, job costing and spend reports.
import {
  api, get, esc, card, list, money, moneyShort, fmtDate, fmtMonth, titleCase, meter,
  openForm, openLightbox, toast, attempt, refresh, today, state,
} from './ui.js';
import { invoicesView } from './views-invoices.js';

const CATEGORIES = ['materials', 'labor', 'subcontractor', 'permit', 'rental', 'fuel', 'other'];
const METHODS = ['card', 'check', 'cash', 'ach'];

/* --------------------------- receipt upload --------------------------- */

/**
 * iPhone photos are 3-5 MB each. Downscaling in the browser keeps the box's
 * disk sane and the upload quick over wifi; anything that cannot be decoded
 * (an unusual HEIC, a PDF) is sent through untouched.
 */
async function prepareUpload(file, maxDim = 1600, quality = 0.82) {
  if (!file.type.startsWith('image/')) return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return { blob: file, name: file.name };

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    bitmap.close?.();
    return blob ? { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg' } : { blob: file, name: file.name };
  } catch {
    return { blob: file, name: file.name };
  }
}

async function uploadReceipt(expenseId, file) {
  const { blob, name } = await prepareUpload(file);
  const res = await fetch(`/api/expenses/${expenseId}/receipt?filename=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Receipt upload failed (${res.status})`);
  }
  return res.json();
}

/* ----------------------------- expense form ---------------------------- */

async function expenseFields(values = {}) {
  const [jobs, vendors] = await Promise.all([get('/api/jobs'), get('/api/vendors')]);
  return [
    { name: 'spent_on', label: 'Date', type: 'date', value: values.spent_on ?? today(), required: true },
    { name: 'amount', label: 'Amount', inputmode: 'decimal', required: true,
      value: values.amount_cents != null ? (values.amount_cents / 100).toFixed(2) : '' },
    { name: 'category', label: 'Category', type: 'select', value: values.category ?? 'materials',
      options: CATEGORIES.map((c) => ({ value: c, label: titleCase(c) })) },
    { name: 'job_id', label: 'Job', type: 'select', value: values.job_id ?? '',
      options: [{ value: '', label: '— Overhead (no job) —' }]
        .concat(jobs.map((j) => ({ value: j.id, label: `${j.job_number} ${j.title}` }))) },
    { name: 'vendor_id', label: 'Vendor', type: 'select', value: values.vendor_id ?? '',
      options: [{ value: '', label: '— None —' }]
        .concat(vendors.map((v) => ({ value: v.id, label: v.name }))) },
    { name: 'payment_method', label: 'Paid with', type: 'select', value: values.payment_method ?? '',
      options: [{ value: '', label: '—' }].concat(METHODS.map((m) => ({ value: m, label: m.toUpperCase() }))) },
    { name: 'description', label: 'What was it for?', value: values.description ?? '' },
    { name: 'tax', label: 'Tax (optional)', inputmode: 'decimal',
      value: values.tax_cents ? (values.tax_cents / 100).toFixed(2) : '' },
    { name: 'billable', label: 'Billable to the client', type: 'checkbox',
      value: values.billable === undefined ? true : values.billable },
  ];
}

export async function newExpense(presetJobId) {
  const fields = await expenseFields(presetJobId ? { job_id: presetJobId } : {});
  fields.push({ name: 'receipt', label: 'Receipt photo', type: 'file', capture: true,
    hint: 'Optional. Photos are shrunk before upload.' });

  const form = await openForm({ title: 'Add expense', submitLabel: 'Save expense', fields });
  if (!form) return;

  try {
    const { receipt, ...rest } = form;
    const expense = await api('POST', '/api/expenses', rest);
    if (receipt) {
      toast('Saved. Uploading receipt…');
      await uploadReceipt(expense.id, receipt);
    }
    toast(`${money(expense.amount_cents)} logged`);
    refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function editExpense(expense) {
  const form = await openForm({
    title: 'Edit expense',
    fields: await expenseFields(expense),
    values: { job_id: expense.job_id ?? '', vendor_id: expense.vendor_id ?? '' },
  });
  if (!form) return;
  await attempt(() => api('PATCH', `/api/expenses/${expense.id}`, form), 'Expense updated');
}

/* ------------------------------ rendering ------------------------------ */

function expenseRow(expense, { hideJob = false } = {}) {
  const where = hideJob
    ? ''
    : (expense.job_id
      ? `<a href="#/jobs/${expense.job_id}">${esc(expense.job_number)}</a>`
      : '<span class="pill s-complete">Overhead</span>');
  const receipts = expense.receipts.map((r) => (
    `<button class="receipt-chip" data-receipt="${r.id}" type="button" title="View receipt">Receipt</button>`
  )).join('');

  return `<li><div class="list-link" data-expense="${expense.id}">
    <span>
      <span class="title">${money(expense.amount_cents)}</span>
      <span class="pill cat">${esc(titleCase(expense.category))}</span>
      ${expense.billable ? '' : '<span class="pill s-cancelled">Not billable</span>'}
      <br><span class="meta">${[
        fmtDate(expense.spent_on), where,
        expense.vendor_name ? esc(expense.vendor_name) : '',
        expense.description ? esc(expense.description) : '',
      ].filter(Boolean).join(' &middot; ')}</span>
    </span>
    <span class="right">${receipts}
      <button class="btn btn-sm" data-edit="${expense.id}" type="button">Edit</button></span>
  </div></li>`;
}

/** Wires the receipt and edit buttons inside any container holding expense rows. */
export function wireExpenseRows(root, expenses) {
  const byId = new Map(expenses.map((e) => [String(e.id), e]));

  root.querySelectorAll('[data-receipt]').forEach((btn) => {
    btn.addEventListener('click', () => openLightbox(`/api/attachments/${btn.dataset.receipt}`));
  });
  root.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => editExpense(byId.get(btn.dataset.edit)));
  });
}

/* ------------------------------ expenses ------------------------------ */

export async function moneyView(params) {
  const tab = params.get('tab') || 'expenses';
  const subTab = (label, value) => `<a class="btn btn-sm${tab === value ? ' btn-primary' : ''}"
    href="#/money?tab=${value}">${esc(label)}</a>`;

  const view = document.getElementById('view');

  if (tab === 'invoices') {
    view.innerHTML = `
      <div class="page-head"><h1>Money</h1></div>
      <div class="row" style="margin-bottom:14px">${subTab('Expenses', 'expenses')}${subTab('Invoices', 'invoices')}</div>
      ${await invoicesView(params)}`;
    return;
  }

  const query = new URLSearchParams();
  for (const key of ['job_id', 'category', 'from', 'to', 'overhead']) {
    if (params.get(key)) query.set(key, params.get(key));
  }
  const { totals, expenses } = await get(`/api/expenses?${query}`);
  const category = params.get('category') || '';

  const chip = (label, key, value) => {
    const active = (params.get(key) || '') === value;
    const next = new URLSearchParams(params);
    next.set('tab', 'expenses');
    if (value) next.set(key, value); else next.delete(key);
    return `<a class="btn btn-sm${active ? ' btn-primary' : ''}" href="#/money?${next}">${esc(label)}</a>`;
  };

  view.innerHTML = `
    <div class="page-head"><h1>Money</h1>
      <span class="muted">${totals.count} expense${totals.count === 1 ? '' : 's'} &middot; ${money(totals.total_cents)}</span>
    </div>
    <div class="row" style="margin-bottom:14px">${subTab('Expenses', 'expenses')}${subTab('Invoices', 'invoices')}</div>
    <div class="row" style="margin-bottom:12px">
      ${chip('All', 'category', '')}
      ${CATEGORIES.map((c) => chip(titleCase(c), 'category', c)).join('')}
      ${chip('Overhead only', 'overhead', '1')}
    </div>
    ${card('', list(expenses, expenseRow,
      category ? `No ${category} expenses recorded.` : 'No expenses yet. Add the first one from the header.'),
      { flush: true })}
    <div class="row" style="margin-top:16px">
      <button class="btn btn-primary" id="add-expense" type="button">Add expense</button>
      <button class="btn" id="add-vendor" type="button">Add vendor</button>
    </div>`;

  wireExpenseRows(view, expenses);
  document.getElementById('add-expense').addEventListener('click', () => newExpense());
  document.getElementById('add-vendor').addEventListener('click', addVendor);
}

async function addVendor() {
  const form = await openForm({
    title: 'Add vendor',
    submitLabel: 'Add vendor',
    fields: [
      { name: 'name', label: 'Vendor name', required: true },
      { name: 'category', label: 'What they supply', hint: 'e.g. lumber, plumbing, equipment rental' },
      { name: 'account_number', label: 'Account number' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  });
  if (!form) return;
  await attempt(() => api('POST', '/api/vendors', form), 'Vendor added');
}

/* -------------------------- job money panel --------------------------- */

export async function renderJobMoney(container, jobId) {
  const costs = await get(`/api/jobs/${jobId}/costs`);
  const marginClass = costs.margin_cents === null ? '' : (costs.margin_cents < 0 ? ' negative' : ' positive');

  container.innerHTML = `
    <div class="card-head">
      <h2>Money</h2>
      <div class="row" style="margin-left:auto">
        <button class="btn btn-sm" id="edit-budget" type="button">Budget</button>
        <button class="btn btn-sm btn-primary" id="job-add-expense" type="button">Add expense</button>
      </div>
    </div>
    <div class="card-body">
      <div class="money-row">
        <div><span class="k">Contract</span><span class="v">${money(costs.contract_cents)}</span></div>
        <div><span class="k">Spent</span><span class="v">${money(costs.spent_cents)}</span></div>
        <div><span class="k">Margin</span><span class="v${marginClass}">${money(costs.margin_cents)}${
          costs.margin_percent === null ? '' : ` <span class="meta">(${costs.margin_percent}%)</span>`}</span></div>
      </div>
      ${costs.budget_vs_actual.some((l) => l.budget_cents !== null || l.spent_cents > 0)
        ? costs.budget_vs_actual.map((l) => meter(titleCase(l.line), l.spent_cents, l.budget_cents)).join('')
        : '<p class="muted" style="margin:4px 0 0">No budget set yet. Add one to track spend against it.</p>'}
    </div>
    ${list(costs.expenses, (e) => expenseRow(e, { hideJob: true }), 'No expenses logged against this job.')}`;

  wireExpenseRows(container, costs.expenses);
  document.getElementById('job-add-expense').addEventListener('click', () => newExpense(jobId));
  document.getElementById('edit-budget').addEventListener('click', () => editBudget(jobId));
}

async function editBudget(jobId) {
  const budget = await get(`/api/jobs/${jobId}/budget`);
  const dollars = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

  const form = await openForm({
    title: 'Job budget',
    submitLabel: 'Save budget',
    fields: [
      { name: 'contract', label: 'Contract amount', inputmode: 'decimal', value: dollars(budget.contract_cents),
        hint: 'What the client is paying. Drives the margin figure.' },
      { name: 'materials_budget', label: 'Materials budget', inputmode: 'decimal', value: dollars(budget.materials_budget_cents) },
      { name: 'labor_budget', label: 'Labor budget', inputmode: 'decimal', value: dollars(budget.labor_budget_cents),
        hint: 'Labor and subcontractor spend both count against this.' },
      { name: 'other_budget', label: 'Everything else', inputmode: 'decimal', value: dollars(budget.other_budget_cents) },
    ],
  });
  if (!form) return;
  await attempt(() => api('PUT', `/api/jobs/${jobId}/budget`, form), 'Budget saved');
}

/* ------------------------------- reports ------------------------------ */

export async function reportsView(params) {
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const [report, exec] = await Promise.all([
    get(`/api/reports/spend?${query}`),
    get('/api/reports/executive'),
  ]);

  const rangeChip = (label, months) => {
    const next = new URLSearchParams();
    if (months) {
      const start = new Date();
      start.setMonth(start.getMonth() - months);
      next.set('from', start.toISOString().slice(0, 10));
    }
    const active = months ? from === next.get('from') : !from;
    return `<a class="btn btn-sm${active ? ' btn-primary' : ''}" href="#/reports?${next}">${esc(label)}</a>`;
  };

  const table = (rows, labelOf, emptyText) => (rows.length
    ? `<table class="table"><tbody>${rows.map((r) => `<tr>
        <td>${labelOf(r)}</td>
        <td class="num meta">${r.count}</td>
        <td class="num">${money(r.cents)}</td>
      </tr>`).join('')}</tbody></table>`
    : `<p class="empty">${esc(emptyText)}</p>`);

  const pct = (v) => (v === null ? '\u2014' : `${v}%`);

  const executive = `
    <div class="tiles">
      <div class="card tile"><div class="n">${pct(exec.estimates.win_rate_percent)}</div>
        <div class="k">Bid win rate</div></div>
      <div class="card tile"><div class="n">${moneyShort(exec.estimates.out_for_decision_cents)}</div>
        <div class="k">Out for decision</div></div>
      <div class="card tile"><div class="n">${moneyShort(exec.backlog.contract_cents)}</div>
        <div class="k">Backlog (${exec.backlog.job_count} jobs)</div></div>
      <a class="card tile${exec.receivables.overdue_cents > 0 ? ' alert' : ''}" href="#/money?tab=invoices&status=outstanding">
        <div class="n">${moneyShort(exec.receivables.outstanding_cents)}</div>
        <div class="k">Owed to you</div></a>
      <div class="card tile"><div class="n">${exec.leads.open}</div><div class="k">Open leads</div></div>
    </div>
    <div class="two-col" style="margin-bottom:16px">
      ${card('Where the work comes from',
        exec.leads.by_source.length
          ? `<table class="table"><tbody>${exec.leads.by_source.map((r) => `<tr>
              <td>${esc(titleCase(r.source))}</td>
              <td class="num meta">${r.converted} of ${r.total} won</td>
              <td class="num">${r.total ? Math.round((r.converted / r.total) * 100) : 0}%</td>
            </tr>`).join('')}</tbody></table>`
          : '<p class="empty">No leads recorded yet.</p>', { flush: true })}
      ${card('Money owed to you',
        exec.receivables.outstanding_cents
          ? `<table class="table"><tbody>${exec.receivables.aging.map((b) => `<tr>
              <td>${esc(b.label)}</td><td class="num">${money(b.cents)}</td>
            </tr>`).join('')}</tbody></table>`
          : '<p class="empty">Nothing outstanding.</p>', { flush: true })}
    </div>
    ${exec.completed_jobs.length ? `<div class="stack" style="margin-bottom:16px">${card('Margin on finished jobs',
      `<table class="table"><tbody>${exec.completed_jobs.map((j) => `<tr>
        <td><a href="#/jobs/${j.id}">${esc(j.job_number)} ${esc(j.title)}</a></td>
        <td class="num meta">${j.contract_cents === null
          ? `${money(j.spent_cents)} spent`
          : `${money(j.contract_cents)} contract`}</td>
        <td class="num">${j.margin_cents === null
          ? '<span class="meta">no contract set</span>'
          : `${money(j.margin_cents)}${j.margin_percent === null ? '' : ` (${j.margin_percent}%)`}`}</td>
      </tr>`).join('')}</tbody></table>`, { flush: true })}</div>` : ''}`;

  document.getElementById('view').innerHTML = `
    <div class="page-head"><h1>Reports</h1>
      <span class="muted">${money(report.total_cents)} spent${from ? ` since ${fmtDate(from)}` : ''}</span>
    </div>
    ${executive}
    <h2 style="margin:24px 0 12px">Spend</h2>
    <div class="row" style="margin-bottom:12px">
      ${rangeChip('All time', 0)}${rangeChip('Last 3 months', 3)}${rangeChip('Last 12 months', 12)}
    </div>
    <div class="tiles">
      <div class="card tile"><div class="n">${moneyShort(report.total_cents)}</div><div class="k">Total spend</div></div>
      <div class="card tile"><div class="n">${moneyShort(report.total_cents - report.overhead_cents)}</div><div class="k">On jobs</div></div>
      <div class="card tile"><div class="n">${moneyShort(report.overhead_cents)}</div><div class="k">Overhead</div></div>
    </div>
    <div class="two-col">
      ${card('By month', table(report.by_month, (r) => esc(fmtMonth(r.month)), 'Nothing recorded yet.'), { flush: true })}
      ${card('By category', table(report.by_category, (r) => esc(titleCase(r.category)), 'Nothing recorded yet.'), { flush: true })}
    </div>
    <div class="two-col" style="margin-top:16px">
      ${card('By job', table(report.by_job,
        (r) => `<a href="#/jobs/${r.job_id}">${esc(r.job_number)} ${esc(r.title)}</a>`, 'No job spend yet.'), { flush: true })}
      ${card('By vendor', table(report.by_vendor, (r) => esc(r.vendor), 'No vendors yet.'), { flush: true })}
    </div>`;
}
