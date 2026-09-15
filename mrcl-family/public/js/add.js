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
import {
  addItem,
  addShoppingItem,
  clearBoughtShopping,
  deleteItem,
  deleteShoppingItem,
  setDone,
  setShoppingDone,
  setTick,
  subscribeToWeek,
  tickKey,
  updateItem,
} from './store.js';
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
  repeatSelect: document.querySelector('[name="repeat"]'),
  shoppingForm: document.querySelector('[data-shopping-form]'),
  shoppingInput: document.querySelector('#shopping-input'),
  shoppingSubmit: document.querySelector('[data-shopping-submit]'),
  shoppingMessage: document.querySelector('[data-shopping-message]'),
  shoppingList: document.querySelector('[data-shopping-list]'),
  shoppingCount: document.querySelector('[data-shopping-count]'),
  shoppingClear: document.querySelector('[data-shopping-clear]'),
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
  repeatingItems: [],
  shopping: [],
  ticks: {},
  calendarItems: [],
  editingId: null,
  editingRepeating: false,
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

/** A birthday is almost always yearly; everything else is almost always once. */
function suggestRepeat() {
  if (state.editingId) return;
  els.repeatSelect.value = els.categorySelect.value === 'birthday' ? 'annual' : 'none';
}

function readForm() {
  const data = new FormData(els.form);
  return {
    title: data.get('title'),
    category: data.get('category'),
    who: data.get('who'),
    date: data.get('date'),
    time: data.get('time'),
    repeat: data.get('repeat'),
  };
}

function resetForm({ keepDate = true } = {}) {
  const date = keepDate ? els.form.elements.date.value : toISODate(new Date());
  els.form.reset();
  els.form.elements.date.value = date || toISODate(new Date());
  els.categorySelect.value = DEFAULT_CATEGORY;
  els.repeatSelect.value = 'none';
  state.editingId = null;
  state.editingRepeating = false;
  els.formTitle.textContent = 'Add to the week';
  els.submit.textContent = 'Add to the week';
  els.cancel.hidden = true;
  suggestRepeat();
}

function startEditing(item) {
  const repeat = item.repeat || (item.annual ? 'annual' : 'none');
  state.editingId = item.id;
  state.editingRepeating = repeat !== 'none';
  els.form.hidden = false;
  els.form.elements.title.value = item.title;
  els.form.elements.category.value = item.category;
  els.form.elements.who.value = item.who || '';
  els.form.elements.date.value = item.date;
  els.form.elements.time.value = item.time || '';
  els.repeatSelect.value = repeat;
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
      await updateItem(state.editingId, input, { days: state.days, repeating: state.editingRepeating });
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
  const repeating = Boolean(item.repeat && item.repeat !== 'none') || Boolean(item.annual);
  done.addEventListener('click', () =>
    guard(done, () =>
      item.readOnly
        ? setTick(tickKey(item), !item.done, state.days)
        : setDone(item.id, !item.done, { days: state.days, repeating }),
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
      guard(remove, () => deleteItem(item.id, { days: state.days, repeating }));
    });
    actions.append(remove);
  }

  row.append(actions);
  return row;
}

function allItems() {
  const own = itemsForWeek([...state.ownItems, ...state.repeatingItems], state.days);
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

/* ------------------------------------------------------------ shopping list */

function shoppingRow(item) {
  const row = el('div', 'shop-row');
  if (item.done) row.classList.add('is-done');

  const toggle = el('button', 'shop-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', String(Boolean(item.done)));
  toggle.setAttribute('aria-label', `${item.done ? 'Put back on the list' : 'Got'} ${item.title}`);
  toggle.append(el('span', 'box', item.done ? '✓' : ''));
  toggle.append(el('span', 'shop-title', item.title));
  toggle.addEventListener('click', () => guard(toggle, () => setShoppingDone(item.id, !item.done)));
  row.append(toggle);

  const remove = el('button', 'shop-remove', '✕');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${item.title}`);
  remove.addEventListener('click', () => guard(remove, () => deleteShoppingItem(item.id)));
  row.append(remove);

  return row;
}

function renderShopping() {
  const items = state.shopping;
  const outstanding = items.filter((i) => !i.done).length;
  const bought = items.length - outstanding;

  els.shoppingCount.textContent = items.length ? `${outstanding} to get` : '';
  els.shoppingClear.hidden = bought === 0;
  els.shoppingClear.textContent = `Clear ${bought} in the trolley`;

  els.shoppingList.replaceChildren();
  if (!items.length) {
    els.shoppingList.append(el('p', 'empty-week', 'Nothing on the list.'));
    return;
  }

  // Still needed first; what is already in the trolley sinks to the bottom.
  const ordered = [...items].sort((a, b) => Number(a.done) - Number(b.done));
  for (const item of ordered) els.shoppingList.append(shoppingRow(item));
}

async function onShoppingSubmit(event) {
  event.preventDefault();
  const title = els.shoppingInput.value.trim();
  if (!title) return;

  els.shoppingSubmit.disabled = true;
  say(els.shoppingMessage, '');
  try {
    await addShoppingItem(title);
    els.shoppingInput.value = '';
    els.shoppingInput.focus();
    refresh();
  } catch (error) {
    say(els.shoppingMessage, error.message || 'Could not add that.', 'is-error');
  } finally {
    els.shoppingSubmit.disabled = false;
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
    ({ items, ticks, repeating, shopping }) => {
      state.ownItems = items;
      state.ticks = ticks;
      state.repeatingItems = repeating;
      state.shopping = shopping;
      renderList();
      renderShopping();
    },
    (message) => {
      if (message) say(els.message, message, 'is-error');
    },
  );

  state.calendarItems = [];
  renderList();
  renderShopping();
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
  els.categorySelect.addEventListener('change', suggestRepeat);
  els.shoppingForm.addEventListener('submit', onShoppingSubmit);
  els.shoppingClear.addEventListener('click', () =>
    guard(els.shoppingClear, () => clearBoughtShopping()),
  );
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
