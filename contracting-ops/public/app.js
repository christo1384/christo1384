// Router and boot. Everything behind the sign-in screen needs a session.
import { get, state, ApiError } from './ui.js';
import { signInView, accountMenu } from './views-auth.js';
import {
  dashboardView, jobsView, jobDetailView, clientsView, clientDetailView,
} from './views-core.js';
import { moneyView, reportsView, newExpense } from './views-money.js';
import { leadsView, newLead } from './views-leads.js';
import { estimateView } from './views-estimates.js';
import { invoiceView } from './views-invoices.js';

const view = document.getElementById('view');
const topbar = document.getElementById('topbar');

const ROUTES = [
  [/^\/dashboard$/, 'dashboard', () => dashboardView()],
  [/^\/jobs$/, 'jobs', (m, params) => jobsView(params)],
  [/^\/jobs\/(\d+)$/, 'jobs', (m) => jobDetailView(m[1])],
  [/^\/money$/, 'money', (m, params) => moneyView(params)],
  [/^\/expenses$/, 'money', (m, params) => moneyView(params)],
  [/^\/leads$/, 'leads', (m, params) => leadsView(params)],
  [/^\/estimates\/(\d+)$/, 'jobs', (m) => estimateView(m[1])],
  [/^\/invoices\/(\d+)$/, 'money', (m) => invoiceView(m[1])],
  [/^\/reports$/, 'reports', (m, params) => reportsView(params)],
  [/^\/clients$/, 'clients', () => clientsView()],
  [/^\/clients\/(\d+)$/, 'clients', (m) => clientDetailView(m[1])],
];

async function render() {
  if (!state.user) {
    topbar.hidden = true;
    await signInView();
    return;
  }
  topbar.hidden = false;

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
    if (err instanceof ApiError && err.status === 401) {
      state.user = null;
      render();
      return;
    }
    view.innerHTML = `<div class="page-head"><h1>Something went wrong</h1></div>
      <p class="muted">${err.message}</p>`;
  }
}

document.getElementById('new-expense-btn').addEventListener('click', () => newExpense());
document.getElementById('new-lead-btn').addEventListener('click', () => newLead());
document.getElementById('account-btn').addEventListener('click', accountMenu);

window.addEventListener('hashchange', render);
window.addEventListener('app:refresh', render);
window.addEventListener('app:signed-out', render);
window.addEventListener('app:signed-in', () => boot());

async function boot() {
  try {
    state.user = await get('/api/auth/me');
    state.meta = await get('/api/meta');
  } catch {
    state.user = null;
  }
  render();
}

boot();
