// The phone page.
//
// The front door is one box: "soccer thu 4pm lili". The six-field form is
// still there behind "More detail" for the odd case, but nobody should have to
// use it — a form is how the last version asked, and asking that much is part
// of why the board stopped being fed.
//
// Most of what appears here is not typed at all: it comes from the family's
// own Google Calendar, read-only. Those rows can be ticked off without the
// calendar ever being written to.

import { CATEGORIES, category } from './categories.js';
import { CONFIG } from './config.js';
import { fetchCalendarItems, listFeeds } from './calendar.js';
import { DEFAULT_CATEGORY, itemSubtitle, validateItem } from './item.js';
import { describeDraft, parseQuickAdd } from './quickadd.js';
import { addItem, deleteItem, setDone, setTick, subscribeToWeek, tickKey, updateItem } from './store.js';
import { addWeeks, buildWeek, compareItems, formatTime, fromISODate, itemsForWeek, toISODate, weekLabel } from './week.js';

const els = {
  title: document.querySelector('[data-board-title]'),
  quickForm: document.querySelector('[data-quick]'),
  quickInput: document.querySelector('#quick'),
  quickSubmit: document.querySelector('[data-quick-submit]'),
  quickMessage: document.querySelector('[data-quick-message]'),
  understood: document.querySelector('[data-understood]'),
  details: document.querySelector('[data-details]'),
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
  calendarHint: document.querySelector('[data-calendar-hint]'),
};

const state = {
  anchor: new Date(),
  days: [],
  ownItems: [],
  annualItems: [],
  ticks: {},
  calendarItems: [],
  editingId: null,
  editingAnnual: false,
  unsubscribe: null,
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function say(target, text, kind = '') {
  target.textContent = text;
  target.className = `message ${kind}`;
}

/* --------------------------------------------------------------- quick add */

/** Live "this is what I understood" under the box. */
function previewQuickAdd() {
  const raw = els.quickInput.value.trim();
  if (!raw) {
    els.understood.textContent = '';
    return;
  }

  const draft = parseQuickAdd(raw, {
    names: CONFIG.familyNames,
    defaultDate: state.days.some((d) => d.isToday) ? undefined : state.days[0].iso,
  });
  const day = state.days.find((d) => d.iso === draft.date);
  const dayName = day ? day.name : new Date(fromISODate(draft.date)).toDateString();

  const summary = describeDraft(
    { ...draft, time: formatTime(draft.time) },
    { dayName },
  );
  els.understood.textContent = `${category(draft.category).short} · ${summary}`;
}

async function onQuickSubmit(event) {
  event.preventDefault();
  const raw = els.quickInput.value.trim();
  if (!raw) return;

  els.quickSubmit.disabled = true;
  say(els.quickMessage, '');

  try {
    const draft = parseQuickAdd(raw, { names: CONFIG.familyNames });

    const { ok, errors } = validateItem(draft);
    if (!ok) {
      say(els.quickMessage, errors[0].message, 'is-error');
      return;
    }

    // The item may land in a different week from the one being viewed.
    const targetWeek = buildWeek(fromISODate(draft.date), {
      weekStartsOn: CONFIG.weekStartsOn,
      today: new Date(),
    });

    await addItem(
      {
        title: draft.title,
        category: draft.category,
        who: draft.who,
        date: draft.date,
        time: draft.time,
        annual: false,
      },
      targetWeek,
    );

    els.quickInput.value = '';
    els.understood.textContent = '';
    const sameWeek = targetWeek[0].iso === state.days[0].iso;
    say(els.quickMessage, sameWeek ? 'Added — it is on the board now.' : 'Added to a different week.', 'is-ok');
    els.quickInput.focus();
    if (sameWeek) refresh();
  } catch (error) {
    say(els.quickMessage, error.message || 'Could not save that.', 'is-error');
  } finally {
    els.quickSubmit.disabled = false;
  }
}

/* ------------------------------------------------------------ detailed form */

function fillCategories() {
  for (const cat of CATEGORIES) {
    const option = document.createElement('option');
    option.value = cat.id;
    option.textContent = cat.short;
    els.categorySelect.append(option);
  }
  els.categorySelect.value = DEFAULT_CATEGORY;
}

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
  state.editingAnnual = false;
  els.formTitle.textContent = 'Add to the week';
  els.submit.textContent = 'Add to the week';
  els.cancel.hidden = true;
  syncAnnualVisibility();
}

function startEditing(item) {
  state.editingId = item.id;
  state.editingAnnual = Boolean(item.annual);
  els.form.hidden = false;
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

async function onSubmit(event) {
  event.preventDefault();
  els.submit.disabled = true;
  say(els.message, '');

  try {
    const input = readForm();

    // The server validates too — this is so a mistake is caught instantly
    // rather than after a round trip.
    const { ok, errors } = validateItem(input);
    if (!ok) {
      say(els.message, errors[0].message, 'is-error');
      return;
    }

    if (state.editingId) {
      await updateItem(state.editingId, input, { days: state.days, annual: state.editingAnnual });
      say(els.message, 'Saved.', 'is-ok');
      resetForm();
      els.form.hidden = true;
    } else {
      await addItem(input, state.days);
      say(els.message, 'Added.', 'is-ok');
      const keepDate = els.form.elements.date.value;
      resetForm();
      els.form.elements.date.value = keepDate;
    }
    refresh();
  } catch (error) {
    say(els.message, error.message || 'Could not save that.', 'is-error');
  } finally {
    els.submit.disabled = false;
  }
}

/* --------------------------------------------------------------- week list */

async function guard(button, action) {
  button.disabled = true;
  try {
    await action();
    say(els.message, '');
    refresh();
  } catch (error) {
    say(els.message, error.message || 'That did not save.', 'is-error');
  } finally {
    button.disabled = false;
  }
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

  const done = el('button', 'ghost', item.done ? 'Undo' : 'Done');
  done.type = 'button';
  done.setAttribute('aria-label', `${item.done ? 'Un-tick' : 'Tick off'} ${item.title}`);
  done.addEventListener('click', () =>
    guard(done, () =>
      item.readOnly
        ? setTick(tickKey(item), !item.done, state.days)
        : setDone(item.id, !item.done, { days: state.days, annual: item.annual }),
    ),
  );
  actions.append(done);

  if (!item.readOnly) {
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
      guard(remove, () => deleteItem(item.id, { days: state.days, annual: item.annual }));
    });
    actions.append(remove);
  }

  row.append(actions);
  return row;
}

function allItems() {
  const own = itemsForWeek([...state.ownItems, ...state.annualItems], state.days);
  const fromCalendar = state.calendarItems.map((item) => ({
    ...item,
    done: Boolean(state.ticks[tickKey(item)]),
  }));
  return [...own, ...fromCalendar];
}

function renderList() {
  const items = allItems();
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

/** Pull the week again straight after a write, rather than waiting for the poll. */
let refreshTimer = null;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => showWeek(state.anchor, { keepMessages: true }), 150);
}

function showWeek(anchor, { keepMessages = false } = {}) {
  state.anchor = anchor;
  state.days = buildWeek(anchor, { weekStartsOn: CONFIG.weekStartsOn, today: new Date() });
  els.range.textContent = weekLabel(state.days);
  els.today.hidden = state.days.some((d) => d.isToday);
  if (!keepMessages) say(els.message, '');

  state.unsubscribe?.();
  state.unsubscribe = subscribeToWeek(
    state.days,
    ({ items, ticks, annual }) => {
      state.ownItems = items;
      state.ticks = ticks;
      state.annualItems = annual;
      renderList();
    },
    (message) => {
      if (message) say(els.message, message, 'is-error');
    },
  );

  state.calendarItems = [];
  renderList();
  loadCalendars();
}

function start() {
  document.title = `Add · ${CONFIG.boardTitle}`;
  els.title.textContent = CONFIG.boardTitle;
  listFeeds().then((feeds) => {
    if (els.calendarHint) els.calendarHint.hidden = feeds.length > 0;
  });

  fillCategories();
  resetForm({ keepDate: false });

  els.quickForm.addEventListener('submit', onQuickSubmit);
  els.quickInput.addEventListener('input', previewQuickAdd);
  els.details.addEventListener('click', () => {
    els.form.hidden = !els.form.hidden;
    if (!els.form.hidden) els.form.elements.title.focus();
  });

  els.form.addEventListener('submit', onSubmit);
  els.categorySelect.addEventListener('change', syncAnnualVisibility);
  els.cancel.addEventListener('click', () => {
    resetForm();
    els.form.hidden = true;
    say(els.message, '');
  });
  els.prev.addEventListener('click', () => showWeek(addWeeks(state.anchor, -1)));
  els.next.addEventListener('click', () => showWeek(addWeeks(state.anchor, 1)));
  els.today.addEventListener('click', () => showWeek(new Date()));

  showWeek(new Date());
}

start();
