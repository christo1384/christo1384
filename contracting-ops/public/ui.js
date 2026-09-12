// Shared client helpers: fetch wrapper, formatting, cards, the modal form.

export const state = { meta: { statuses: [], priorities: [], stale_days: 7 }, user: null, limits: null };

/* ------------------------------- api ------------------------------- */

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  return data;
}

export const get = (p) => api('GET', p);

/** Tells the router to re-run the current view after a mutation. */
export const refresh = () => window.dispatchEvent(new Event('app:refresh'));

/* ---------------------------- formatting ---------------------------- */

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const statusLabel = (key) => state.meta.statuses.find((s) => s.key === key)?.label ?? key;
export const pill = (status) => `<span class="pill s-${esc(status)}">${esc(statusLabel(status))}</span>`;
export const titleCase = (v) => (v ? v[0].toUpperCase() + v.slice(1).replace(/_/g, ' ') : '');

const MONEY = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

/** Cents to "$1,234.56". Null and undefined render as an em dash, not $0.00. */
export function money(cents, { blank = '—' } = {}) {
  if (cents === null || cents === undefined) return blank;
  return MONEY.format(cents / 100);
}

/** Whole dollars, for tiles where the cents are noise. */
export function moneyShort(cents, { blank = '—' } = {}) {
  if (cents === null || cents === undefined) return blank;
  const dollars = Math.round(cents / 100);
  return `${cents < 0 ? '-' : ''}$${Math.abs(dollars).toLocaleString()}`;
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(+d) ? value : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMonth(value) {
  const d = new Date(`${value}-01T12:00:00`);
  return Number.isNaN(+d) ? value : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** SQLite stores UTC without a zone marker; make it explicit before parsing. */
export function fmtWhen(value) {
  if (!value) return '';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(+d)) return value;
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days === 0) return `today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysSince(value) {
  if (!value) return null;
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(+d) ? null : Math.floor((Date.now() - d) / 86400000);
}

export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

/* ------------------------------ chrome ------------------------------ */

export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2800);
}

export function card(title, bodyHtml, { actions = '', flush = false } = {}) {
  return `<section class="card">
    ${title ? `<div class="card-head"><h2>${esc(title)}</h2>${actions ? `<div class="row" style="margin-left:auto">${actions}</div>` : ''}</div>` : ''}
    ${flush ? bodyHtml : `<div class="card-body">${bodyHtml}</div>`}
  </section>`;
}

export function list(items, renderItem, emptyText) {
  if (!items.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return `<ul class="list">${items.map(renderItem).join('')}</ul>`;
}

export function jobRow(job, extraRight = '') {
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

/** A labelled bar showing spend against a budget line. */
export function meter(label, spentCents, budgetCents) {
  const over = budgetCents !== null && spentCents > budgetCents;
  const pct = budgetCents ? Math.min(100, Math.round((spentCents / budgetCents) * 100)) : 0;
  return `<div class="meter">
    <div class="meter-head">
      <span>${esc(label)}</span>
      <span class="meta">${money(spentCents)}${budgetCents === null ? '' : ` of ${money(budgetCents)}`}</span>
    </div>
    <div class="meter-track"><div class="meter-fill${over ? ' over' : ''}" style="width:${budgetCents ? pct : 0}%"></div></div>
  </div>`;
}

export function openLightbox(src) {
  const box = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = src;
  box.showModal();
}

document.getElementById('lightbox-close')?.addEventListener('click', () => {
  document.getElementById('lightbox').close();
});

/* ---------------------------- modal form ---------------------------- */

/**
 * Renders a form in the dialog and resolves with the field values, or null
 * when the user cancels. `fields` is a list of { name, label, type, ... }.
 */
export function openForm({ title, fields, submitLabel = 'Save', values = {} }) {
  const modal = document.getElementById('modal');
  const fieldsEl = document.getElementById('modal-fields');
  const errorEl = document.getElementById('modal-error');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-save').textContent = submitLabel;
  errorEl.hidden = true;

  fieldsEl.innerHTML = fields.map((f) => {
    const value = values[f.name] ?? f.value ?? '';
    const common = `id="f-${f.name}" name="${f.name}"`;
    if (f.type === 'checkbox') {
      return `<div class="field field-check">
        <label for="f-${f.name}"><input ${common} type="checkbox"${value ? ' checked' : ''}> ${esc(f.label)}</label>
      </div>`;
    }
    let input;
    if (f.type === 'textarea') input = `<textarea ${common} rows="3">${esc(value)}</textarea>`;
    else if (f.type === 'select') {
      input = `<select ${common}>${f.options.map((o) => (
        `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`
      )).join('')}</select>`;
    } else if (f.type === 'file') {
      input = `<input ${common} type="file" accept="${esc(f.accept ?? 'image/*,application/pdf')}"${f.capture ? ' capture="environment"' : ''}>`;
    } else {
      input = `<input ${common} type="${f.type || 'text'}"${f.inputmode ? ` inputmode="${f.inputmode}"` : ''} value="${esc(value)}">`;
    }
    return `<div class="field"><label for="f-${f.name}">${esc(f.label)}</label>${input}${
      f.hint ? `<p class="meta" style="margin:4px 0 0">${esc(f.hint)}</p>` : ''}</div>`;
  }).join('');

  modal.showModal();
  fieldsEl.querySelector('input:not([type=file]), select, textarea')?.focus();

  return new Promise((resolve) => {
    const save = document.getElementById('modal-save');
    const finish = (result) => {
      save.removeEventListener('click', onSave);
      modal.removeEventListener('close', onClose);
      resolve(result);
    };
    const onSave = () => {
      const out = {};
      for (const f of fields) {
        const el = fieldsEl.querySelector(`[name="${f.name}"]`);
        if (f.type === 'checkbox') out[f.name] = el.checked;
        else if (f.type === 'file') out[f.name] = el.files[0] ?? null;
        else out[f.name] = el.value.trim();
      }
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

/** Runs an action, showing its error as a toast instead of breaking the view. */
export async function attempt(fn, successMessage) {
  try {
    const result = await fn();
    if (successMessage) toast(successMessage);
    refresh();
    return result;
  } catch (err) {
    toast(err.message);
    return null;
  }
}
