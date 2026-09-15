// The kitchen board.
//
// Always shows the current week, rebuilds itself when the date rolls over, and
// updates the moment someone taps Done on a phone. There are no controls: a TV
// on a wall has nobody to press them.

import { BAND_CATEGORIES, GRID_CATEGORIES } from './categories.js';
import { CONFIG, isConfigured, missingFirebaseKeys } from './config.js';
import { fetchCalendarItems } from './calendar.js';
import { itemSubtitle } from './item.js';
import { subscribeToWeek } from './store.js';
import { bandItems, buildWeek, formatTime, groupByCategoryAndDay, itemsForWeek, weekLabel } from './week.js';
import { fetchForecast } from './weather.js';

const MAX_PER_CELL = 4;
const CLOCK_MS = 20_000;

const els = {
  title: document.querySelector('[data-board-title]'),
  range: document.querySelector('[data-week-range]'),
  clock: document.querySelector('[data-clock]'),
  board: document.querySelector('[data-board]'),
  weather: document.querySelector('[data-weather]'),
  bandTop: document.querySelector('[data-band="top"]'),
  bandBottom: document.querySelector('[data-band="bottom"]'),
  status: document.querySelector('[data-status]'),
  hint: document.querySelector('[data-hint]'),
  app: document.querySelector('[data-app]'),
  setup: document.querySelector('[data-setup]'),
  setupMissing: document.querySelector('[data-setup-missing]'),
};

const state = {
  days: [],
  weekKey: '',
  liveItems: [],
  calendarItems: [],
  forecast: {},
  unsubscribe: null,
  error: '',
};

/* ---------------------------------------------------------------- rendering */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function entryNode(item) {
  const node = el('div', 'entry');
  if (item.done) node.classList.add('is-done');
  if (item.readOnly) node.classList.add('from-calendar');

  const time = formatTime(item.time);
  if (time) node.append(el('span', 'entry-time', time));
  node.append(el('span', 'entry-title', item.title));

  const who = itemSubtitle(item);
  if (who) node.append(el('span', 'entry-who', who));
  return node;
}

/** The static scaffold: header row, then a labelled row per grid category. */
function buildBoardSkeleton(days) {
  els.board.replaceChildren();
  els.board.style.gridTemplateRows = `auto repeat(${GRID_CATEGORIES.length}, minmax(0, 1fr))`;

  els.board.append(el('div', 'corner'));

  days.forEach((day, index) => {
    const head = el('div', 'day-head');
    head.style.setProperty('--day-accent', `var(--day-${index})`);
    if (day.isToday) head.classList.add('is-today');
    head.append(el('div', 'day-name', day.short));
    head.append(el('div', 'day-date', `${day.dayNum} ${day.month}`));
    els.board.append(head);
  });

  for (const cat of GRID_CATEGORIES) {
    const label = el('div', 'row-label', cat.label);
    label.style.setProperty('--row-accent', cat.accent);
    els.board.append(label);

    days.forEach((day, index) => {
      const cell = el('div', 'cell');
      cell.dataset.category = cat.id;
      cell.dataset.iso = day.iso;
      cell.dataset.rowLabel = cat.label;
      cell.style.setProperty('--row-accent', cat.accent);
      cell.style.setProperty('--day-accent', `var(--day-${index})`);
      if (day.isToday) cell.classList.add('is-today');
      else if (day.isWeekend) cell.classList.add('is-weekend');
      els.board.append(cell);
    });
  }

  buildWeatherSkeleton(days);
}

function buildWeatherSkeleton(days) {
  els.weather.replaceChildren();
  els.weather.append(el('div', 'band-label', 'Weather'));
  for (const day of days) {
    const cell = el('div', 'wx');
    cell.dataset.iso = day.iso;
    els.weather.append(cell);
  }
}

function renderCells(grouped) {
  for (const cell of els.board.querySelectorAll('.cell')) {
    const items = grouped[cell.dataset.category]?.[cell.dataset.iso] || [];
    cell.replaceChildren();
    cell.dataset.empty = items.length ? 'false' : 'true';

    for (const item of items.slice(0, MAX_PER_CELL)) cell.append(entryNode(item));
    if (items.length > MAX_PER_CELL) {
      cell.append(el('div', 'more', `+${items.length - MAX_PER_CELL} more`));
    }
  }
}

function renderBand(container, cat, items, days) {
  container.style.setProperty('--band-accent', cat.accent);
  container.replaceChildren();
  container.append(el('div', 'band-label', cat.label));

  const list = el('div', 'band-items');
  const forCategory = bandItems(items, cat.id, days);

  if (!forCategory.length) {
    list.append(el('span', 'empty', cat.id === 'birthday' ? 'None this week' : 'Nothing on'));
  } else {
    for (const item of forCategory) {
      const day = days.find((d) => d.iso === item.date);
      const chip = el('span', 'chip');
      if (item.done) chip.classList.add('is-done');
      if (day?.isToday) chip.classList.add('is-today');
      chip.append(el('span', 'chip-day', day ? day.short : ''));
      chip.append(document.createTextNode(item.title));

      const extra = itemSubtitle(item);
      if (extra) chip.append(el('span', 'entry-who', ` ${extra}`));
      list.append(chip);
    }
  }
  container.append(list);
}

function renderWeather() {
  const cells = els.weather.querySelectorAll('.wx');
  const known = cells.length && Object.keys(state.forecast).length > 0;
  els.weather.hidden = !known;
  if (!known) return;

  for (const cell of cells) {
    const day = state.forecast[cell.dataset.iso];
    cell.replaceChildren();
    if (!day) {
      cell.append(el('span', 'wx-icon', '·'));
      continue;
    }
    cell.append(el('span', 'wx-icon', day.icon));
    if (day.max !== null) cell.append(el('span', 'wx-temp', `${day.max}°`));
    if (day.min !== null) cell.append(el('span', 'wx-min', `${day.min}°`));
  }
}

function render() {
  const all = [...itemsForWeek(state.liveItems, state.days), ...state.calendarItems];

  renderCells(groupByCategoryAndDay(all));
  for (const cat of BAND_CATEGORIES) {
    renderBand(cat.band === 'top' ? els.bandTop : els.bandBottom, cat, all, state.days);
  }
  renderWeather();
  renderStatus(all.length);
}

function renderStatus(count) {
  if (state.error) {
    els.status.textContent = state.error;
    els.status.className = 'status is-error';
    return;
  }
  els.status.textContent = `${count} thing${count === 1 ? '' : 's'} on this week`;
  els.status.className = 'status is-live';
}

function renderClock() {
  const now = new Date();
  els.clock.textContent = formatTime(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  );
}

/* -------------------------------------------------------------- data wiring */

function loadCalendars() {
  fetchCalendarItems(state.days)
    .then((items) => {
      state.calendarItems = items;
      render();
    })
    .catch(() => {
      state.calendarItems = [];
    });
}

function loadWeather() {
  fetchForecast(CONFIG.weather, { start: state.days[0].iso, end: state.days[6].iso })
    .then((forecast) => {
      state.forecast = forecast;
      renderWeather();
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
  state.days = buildWeek(anchor, { weekStartsOn: CONFIG.weekStartsOn, today: anchor });
  state.weekKey = state.days[0].iso;
  state.error = '';

  els.range.textContent = weekLabel(state.days);
  buildBoardSkeleton(state.days);

  state.unsubscribe?.();
  state.unsubscribe = subscribeToWeek(
    state.days,
    (items) => {
      state.liveItems = items;
      state.error = '';
      render();
    },
    (reason) => {
      state.error = ERROR_MESSAGES[reason] || 'Something went wrong talking to Firebase.';
      render();
    },
  );

  loadCalendars();
  loadWeather();
  render();
}

/** Rebuild at midnight, and refresh the feeds periodically. */
function startTimers() {
  setInterval(renderClock, CLOCK_MS);

  setInterval(() => {
    const now = new Date();

    // The week the clock is actually in, versus the one on screen.
    const currentKey = buildWeek(now, { weekStartsOn: CONFIG.weekStartsOn, today: now })[0].iso;
    const staleDay = !state.days.some((d) => d.isToday);
    if (currentKey !== state.weekKey || staleDay) {
      showWeek(now);
      return;
    }

    // Pick up a new deploy overnight, when nobody is looking at the board.
    if (now.getHours() === CONFIG.tv.reloadHour && now.getMinutes() < 2) {
      window.location.reload();
    }
  }, 60_000);

  setInterval(() => {
    loadCalendars();
    loadWeather();
  }, Math.max(1, CONFIG.tv.refreshMinutes) * 60_000);
}

/* --------------------------------------------------------------- start here */

function start() {
  document.title = CONFIG.boardTitle;
  els.title.textContent = CONFIG.boardTitle;
  if (els.hint) els.hint.textContent = `${window.location.host}/add`;

  if (!isConfigured()) {
    els.app.hidden = true;
    els.setup.hidden = false;
    els.setupMissing.textContent = missingFirebaseKeys().join(', ');
    return;
  }

  renderClock();
  showWeek(new Date());
  startTimers();
}

start();
