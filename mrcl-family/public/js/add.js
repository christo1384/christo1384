// The phone page.
//
// Add something to the week, tick it off, fix a mistake. No setup screen, no
// gear icon, no keys to paste — the deploy already knows which family this is.

import { CATEGORIES, category } from './categories.js';
import { CONFIG, isConfigured, missingFirebaseKeys } from './config.js';
import { fetchCalendarItems } from './calendar.js';
import { DEFAULT_CATEGORY, itemSubtitle } from './item.js';
import { addItem, deleteItem, setDone, subscribeToWeek, updateItem } from './store.js';
import { addWeeks, buildWeek, compareItems, formatTime, itemsForWeek, toISODate, weekLabel } from './week.js';

const els = {
  app: document.querySelector('[data-app]'),
  setup: document.querySelector('[data-setup]'),
  setupMissing: document.querySelector('[data-setup-missing]'),
  title: document.querySelector('[data-board-title]'),
  form: document.querySelector('[data-form]'),
  formTitle: document.querySelector('[data-form-title]'),
  submit: document.querySelector('[data-submit]'),
  cancel: document.querySelector('[data-cancel]'),
  message: document.querySelector('[data-message]'),
  categorySelect: document.querySelector('[name="category"]'),
  annualField: document.querySelector('[data-annual-field]'),
  annualInput: document.querySelector('[name="annual"]'),
  range: document.querySelector('[data-week-range]'),
  prev: document.querySelector('[data-prev]'),
  next: document.querySelector('[data-next]'),
  today: document.querySelector('[data-today]'),
  list: document.querySelector('[data-list]'),
};

const state = {
  anchor: new Date(),
  days: [],
  liveItems: [],
  calendarItems: [],
  editingId: null,
  unsubscribe: null,
};

/* -------------------------------------------------------------------- form */

function fillCategories() {
  for (const cat of CATEGORIES) {
    const option = document.createElement('option');
    option.value = cat.id;
    option.textContent = cat.short;
    els.categorySelect.append(option);
  }
  els.categorySelect.value = DEFAULT_CATEGORY;
}

/** The annual tick only makes sense for birthdays. */
function syncAnnualVisibility() {
  const isBirthday = els.categorySelect.value === 'birthday';
  els.annualField.hidden = !isBirthday;
  if (isBirthday && !state.editingId) els.annualInput.checked = true;
  if (!isBirthday) els.annualInput.checked = false;
}

function readForm() {
  const data = new FormData(els.form);
  return {
    title: data.get('title'),
    category: data.get('category'),
    who: data.get('who'),
    date: data.get('date'),
    time: data.get('time'),
    annual: els.annualInput.checked,
  };
}

function resetForm({ keepDate = true } = {}) {
  const date = keepDate ? els.form.elements.date.value : toISODate(new Date());
  els.form.reset();
  els.form.elements.date.value = date || toISODate(new Date());
  els.categorySelect.value = DEFAULT_CATEGORY;
  state.editingId = null;
  els.formTitle.textContent = 'Add to the week';
  els.submit.textContent = 'Add to the week';
  els.cancel.hidden = true;
  syncAnnualVisibility();
}

function startEditing(item) {
  state.editingId = item.id;
  els.form.elements.title.value = item.title;
  els.form.elements.category.value = item.category;
  els.form.elements.who.value = item.who || '';
  els.form.elements.date.value = item.date;
  els.form.elements.time.value = item.time || '';
  els.annualInput.checked = Boolean(item.annual);
  els.annualField.hidden = item.category !== 'birthday';
  els.formTitle.textContent = 'Edit';
  els.submit.textContent = 'Save changes';
  els.cancel.hidden = false;
  els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  els.form.elements.title.focus();
}

function say(text, kind = '') {
  els.message.textContent = text;
  els.message.className = `message ${kind}`;
}

async function onSubmit(event) {
  event.preventDefault();
  els.submit.disabled = true;
  say('');

  try {
    const input = readForm();
    if (state.editingId) {
      await updateItem(state.editingId, input);
      say('Saved.', 'is-ok');
      resetForm();
    } else {
      await addItem(input);
      say('Added — it is on the kitchen board now.', 'is-ok');
      const keepDate = els.form.elements.date.value;
      resetForm();
      els.form.elements.date.value = keepDate;
      els.form.elements.title.focus();
    }
  } catch (error) {
    say(error.message || 'Could not save that.', 'is-error');
  } finally {
    els.submit.disabled = false;
  }
}

/* --------------------------------------------------------------- week list */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rowNode(item) {
  const cat = category(item.category);
  const row = el('div', 'row');
  row.style.setProperty('--row-accent', cat.accent);
  if (item.done) row.classList.add('is-done');
  if (item.readOnly) row.classList.add('read-only');

  const main = el('div', 'row-main');
  main.append(el('span', 'row-title', item.title));

  const meta = [cat.short, formatTime(item.time), itemSubtitle(item)].filter(Boolean).join(' · ');
  main.append(el('span', 'row-meta', meta));
  row.append(main);

  const actions = el('div', 'row-actions');

  if (item.readOnly) {
    // Calendar events belong to the calendar; changing them here would be a lie.
    actions.append(el('span', 'row-meta', '🗓'));
  } else {
    const done = el('button', 'ghost', item.done ? 'Undo' : 'Done');
    done.type = 'button';
    done.setAttribute('aria-label', `${item.done ? 'Un-tick' : 'Tick off'} ${item.title}`);
    done.addEventListener('click', () => guard(done, () => setDone(item.id, !item.done)));
    actions.append(done);

    const edit = el('button', 'ghost', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit ${item.title}`);
    edit.addEventListener('click', () => startEditing(item));
    actions.append(edit);

    const remove = el('button', 'ghost', '✕');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete ${item.title}`);
    remove.addEventListener('click', () => {
      if (!window.confirm(`Delete "${item.title}"?`)) return;
      guard(remove, () => deleteItem(item.id));
    });
    actions.append(remove);
  }

  row.append(actions);
  return row;
}

async function guard(button, action) {
  button.disabled = true;
  try {
    await action();
    say('');
  } catch (error) {
    say(error.message || 'That did not save.', 'is-error');
  } finally {
    button.disabled = false;
  }
}

function renderList() {
  const items = [...itemsForWeek(state.liveItems, state.days), ...state.calendarItems];
  els.list.replaceChildren();

  if (!items.length) {
    els.list.append(el('p', 'empty-week', 'Nothing on this week yet.'));
    return;
  }

  for (const day of state.days) {
    const forDay = items.filter((item) => item.date === day.iso).sort(compareItems);
    if (!forDay.length) continue;

    const group = el('section', 'day-group');
    if (day.isToday) group.classList.add('is-today');

    const heading = el('h2');
    heading.append(document.createTextNode(day.name));
    heading.append(el('span', 'row-meta', `${day.dayNum} ${day.month}${day.isToday ? ' · today' : ''}`));
    group.append(heading);

    for (const item of forDay) group.append(rowNode(item));
    els.list.append(group);
  }
}

function loadCalendars() {
  fetchCalendarItems(state.days)
    .then((items) => {
      state.calendarItems = items;
      renderList();
    })
    .catch(() => {});
}

const ERROR_MESSAGES = {
  'permission-denied': 'Firestore refused the read — check the security rules are deployed.',
  'not-configured': 'This deploy has no Firebase configuration.',
  'sdk-unreachable': 'Could not load Firebase. Check this screen has internet.',
  'anonymous-auth-disabled': 'Turn on Anonymous sign-in in the Firebase console (Authentication → Sign-in method).',
  'sign-in-failed': 'Could not sign in to Firebase.',
  'connect-failed': 'Cannot reach Firebase. Check the connection.',
  'read-failed': 'Lost the connection to Firebase. Retrying.',
};

function showWeek(anchor) {
  state.anchor = anchor;
  state.days = buildWeek(anchor, { weekStartsOn: CONFIG.weekStartsOn, today: new Date() });
  els.range.textContent = weekLabel(state.days);
  els.today.hidden = state.days.some((d) => d.isToday);

  state.unsubscribe?.();
  state.unsubscribe = subscribeToWeek(
    state.days,
    (items) => {
      state.liveItems = items;
      renderList();
    },
    (reason) => say(ERROR_MESSAGES[reason] || 'Something went wrong talking to Firebase.', 'is-error'),
  );

  state.calendarItems = [];
  renderList();
  loadCalendars();
}

/* -------------------------------------------------------------- start here */

function start() {
  document.title = `Add · ${CONFIG.boardTitle}`;
  els.title.textContent = CONFIG.boardTitle;

  if (!isConfigured()) {
    els.app.hidden = true;
    els.setup.hidden = false;
    els.setupMissing.textContent = missingFirebaseKeys().join(', ');
    return;
  }

  fillCategories();
  resetForm({ keepDate: false });

  els.form.addEventListener('submit', onSubmit);
  els.categorySelect.addEventListener('change', syncAnnualVisibility);
  els.cancel.addEventListener('click', () => {
    resetForm();
    say('');
  });
  els.prev.addEventListener('click', () => showWeek(addWeeks(state.anchor, -1)));
  els.next.addEventListener('click', () => showWeek(addWeeks(state.anchor, 1)));
  els.today.addEventListener('click', () => showWeek(new Date()));

  showWeek(new Date());
}

start();
