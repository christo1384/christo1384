#!/usr/bin/env node
// Drives both pages in a real browser against a stubbed board API and calendar
// feed, so the whole render path is exercised: calendar entries classifying
// themselves into rows, quick-add, done styling, bands, and the failure states.
//
//   node test/browser/smoke.mjs [--screenshots <dir>]

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright is deliberately not a dependency of this project: Netlify installs
// nothing to build the site, and keeping it that way makes deploys instant.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('This suite needs Playwright, which this project does not depend on.\n  npm install --no-save playwright\nThen run it again.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const PORT = 8099;
const BASE = `http://localhost:${PORT}`;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const screenshotArg = process.argv.indexOf('--screenshots');
const screenshotDir = screenshotArg === -1 ? null : process.argv[screenshotArg + 1];
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// Monday 13 July 2026, so "this week" is fixed no matter when the suite runs.
const FIXED_NOW = new Date(2026, 6, 15, 16, 30, 0).getTime();

const WEEK = '2026-07-13';

const ITEMS = [
  { id: 'i1', title: 'Soccer practice', category: 'sport', date: '2026-07-16', time: '16:00', who: 'Ruby', done: false, annual: false },
  { id: 'i2', title: 'Lasagne', category: 'dinner', date: '2026-07-16', time: '', done: false, annual: false },
  { id: 'i3', title: 'Bins out', category: 'chore', date: '2026-07-14', time: '', done: true, annual: false },
  { id: 'i4', title: 'Dentist', category: 'appointment', date: '2026-07-15', time: '09:15', done: false, annual: false },
  { id: 'i6', title: 'Nana visiting', category: 'out', date: '2026-07-18', time: '', done: false, annual: false },
  { id: 'i7', title: 'Out of range', category: 'chore', date: '2026-09-01', time: '', done: false, annual: false },
];

const ANNUAL = [
  { id: 'a1', title: 'Ruby', category: 'birthday', date: '2017-07-16', time: '', annual: true, done: false },
];

// A real-shaped family-calendar entry: it must classify itself into the
// appointments row and pull "Lili" out of the title, with nobody configuring
// anything.
const CALENDAR_FEED = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:ortho-1',
  'SUMMARY:Lili Ortho 8.20am',
  'DTSTART:20260717T082000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

async function startServer() {
  const child = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error('server did not start')), 10_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('http://localhost')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.on('exit', (code) => rejectReady(new Error(`server exited with ${code}`)));
  });
  return child;
}

/** Stub the board API and the calendar proxy, and freeze the clock. */
async function preparePage(context, { items = ITEMS, annual = ANNUAL, calendars = true, boardDown = false } = {}) {
  const page = await context.newPage();

  // A tiny in-browser stand-in for the board store, so a write really does
  // come back on the next read.
  const store = { items: structuredClone(items), annual: structuredClone(annual), ticks: {}, counter: 0 };

  await page.route('**/api/board*', async (route) => {
    if (boardDown) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"The board is down."}' });
      return;
    }

    const request = route.request();
    const reply = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (request.method() === 'GET') {
      await reply({ week: WEEK, items: store.items, ticks: store.ticks, annual: store.annual });
      return;
    }

    const body = JSON.parse(request.postData() || '{}');
    if (body.op === 'add') {
      store.counter += 1;
      const record = { ...body.item, id: `new_${store.counter}` };
      if (body.item.annual) store.annual.push(record);
      else store.items.push(record);
      await reply({ id: record.id, item: record }, 201);
      return;
    }
    if (body.op === 'patch') {
      const bucket = body.annual ? store.annual : store.items;
      const index = bucket.findIndex((i) => i.id === body.id);
      if (index === -1) return reply({ error: 'gone' }, 404);
      bucket[index] = { ...bucket[index], ...body.patch };
      await reply({ item: bucket[index] });
      return;
    }
    if (body.op === 'delete') {
      store.items = store.items.filter((i) => i.id !== body.id);
      store.annual = store.annual.filter((i) => i.id !== body.id);
      await reply({ ok: true });
      return;
    }
    if (body.op === 'tick') {
      if (body.done) store.ticks[body.key] = true;
      else delete store.ticks[body.key];
      await reply({ ok: true });
      return;
    }
    await reply({ error: 'unknown op' }, 400);
  });

  await page.route('**/api/calendar*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/calendar', body: CALENDAR_FEED }),
  );

  const injected = {
    boardTitle: 'The MRCL family Week',
    weekStartsOn: 1,
    weather: { enabled: false },
    familyNames: ['Lili', 'Ruby', 'Max'],
    calendars: calendars ? ['https://example.com/family.ics'] : [],
  };

  // Stand in for what tools/build-config.mjs writes at deploy time.
  await page.route('**/config.generated.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: `window.__MRCL__ = ${JSON.stringify(injected)};`,
    }),
  );

  await page.addInitScript((now) => {
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(now);
        else super(...args);
      }
      static now() {
        return now;
      }
    }
    globalThis.Date = FrozenDate;
  }, FIXED_NOW);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  return { page, errors, store };
}

const text = (page, selector) => page.locator(selector).first().innerText();

async function testBoard(context) {
  console.log('\nThe board (/)');
  const { page, errors } = await preparePage(context);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.board .cell .entry', { timeout: 5000 });

  check('no page errors', errors.length === 0, errors.join(' | '));
  check('title comes from the config', (await text(page, '[data-board-title]')) === 'The MRCL family Week');
  check('week range is the Monday week', (await text(page, '[data-week-range]')) === '13 – 19 Jul 2026');
  check('clock renders', /^\d{1,2}(:\d{2})?(am|pm)$/.test(await text(page, '[data-clock]')));

  check('seven day columns', (await page.locator('.board .day-head').count()) === 7);
  check('six category rows', (await page.locator('.board .row-label').count()) === 6);
  check('42 cells', (await page.locator('.board .cell').count()) === 42);

  const soccer = page.locator('.cell[data-category="sport"][data-iso="2026-07-16"] .entry');
  check('soccer lands in the right cell', (await soccer.count()) === 1);
  check('soccer shows its time', (await soccer.first().innerText()).includes('4pm'));
  check('soccer shows who it is for', (await soccer.first().innerText()).includes('Ruby'));

  const bins = page.locator('.cell[data-category="chore"][data-iso="2026-07-14"] .entry');
  check('a ticked-off chore is still on the board', (await bins.count()) === 1);
  check('and is marked done', await bins.first().evaluate((el) => el.classList.contains('is-done')));

  const outOfRange = await page.locator('.board .cell .entry', { hasText: 'Out of range' }).count();
  check('an item from another month is not shown', outOfRange === 0);

  // The whole point of the rebuild: this came from the family calendar and
  // nobody typed it into the board or told it which row to use.
  const ortho = page.locator('.cell[data-category="appointment"][data-iso="2026-07-17"] .entry');
  check('a calendar entry classifies itself into a row', (await ortho.count()) === 1);
  const orthoText = (await ortho.first().innerText()).replace(/\s+/g, ' ');
  check('the person is lifted out of the title', orthoText.includes('Ortho') && orthoText.includes('Lili'), orthoText);
  check('and the duplicated time is dropped from the words', !orthoText.includes('8.20am'), orthoText);

  const today = page.locator('.board .day-head.is-today');
  check('today is highlighted once', (await today.count()) === 1);
  // innerText is the rendered text, and the stylesheet uppercases day names.
  check('today is Wednesday', /wed/i.test(await today.innerText()) && (await today.innerText()).includes('15 Jul'));

  const birthdays = await text(page, '[data-band="top"]');
  check('the birthday band names the child', birthdays.includes('Ruby'));
  check('the birthday band counts the years', birthdays.includes('turns 9'));
  check('the birthday band shows the day', birthdays.includes('Thu'));

  const out = await text(page, '[data-band="bottom"]');
  check('the out-and-about band renders', out.includes('Nana visiting') && out.includes('Sat'));

  check('weather hides when it is switched off', await page.locator('[data-weather]').isHidden());
  // Five of the board's own items, one annual birthday, one from the calendar.
  check('status line counts the week', (await text(page, '[data-status]')).includes('7 things on this week'), await text(page, '[data-status]'));

  // The whole board must fit a TV without scrolling.
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    client: document.documentElement.clientHeight,
  }));
  check('board fits the screen without scrolling', overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));

  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'board.png'), fullPage: false });
  await page.close();
}

async function testBoardResilience(context) {
  console.log('\nThe board when its own store is unreachable');
  const { page } = await preparePage(context, { boardDown: true });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.board .cell', { timeout: 5000 });

  check('the board still renders its grid', (await page.locator('.board .cell').count()) === 42);
  const status = await text(page, '[data-status]');
  check('and says what is wrong', status.length > 0 && status.toLowerCase().includes('board'), status);

  // The calendar is a separate path, so it must survive the store being down.
  await page.waitForSelector('.cell[data-category="appointment"] .entry', { timeout: 5000 });
  check('calendar entries still show', (await page.locator('.board .cell .entry').count()) > 0);
  await page.close();
}

async function testNoCalendars(context) {
  console.log('\nA deploy with no calendars connected');
  const { page } = await preparePage(context, { calendars: false });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  // No blocking setup screen any more: the board simply works.
  check('the board renders', (await page.locator('.board .cell').count()) === 42);
  check('the board is not hidden behind a setup screen', await page.locator('[data-app]').isVisible());
  check('but it says nothing is feeding it', await page.locator('[data-calendar-hint]').isVisible());
  await page.close();
}

async function testPhone(context) {
  console.log('\nThe phone page (/add)');
  const { page, errors } = await preparePage(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.day-group .row', { timeout: 5000 });

  check('no page errors', errors.length === 0, errors.join(' | '));
  check('the quick-add box is the front door', await page.locator('#quick').isVisible());
  check('the six-field form is tucked away', await page.locator('[data-form]').isHidden());

  await page.click('[data-details]');
  check('"More detail" opens the full form', await page.locator('[data-form]').isVisible());
  check('the date defaults to today', (await page.inputValue('#date')) === '2026-07-15');
  check('every category is offered', (await page.locator('#category option').count()) === 8);
  check('the yearly tick is hidden for a non-birthday', await page.locator('[data-annual-field]').isHidden());

  await page.selectOption('#category', 'birthday');
  check('the yearly tick appears for a birthday', await page.locator('[data-annual-field]').isVisible());
  check('and defaults to on', await page.isChecked('#annual'));
  await page.selectOption('#category', 'appointment');

  const before = await page.locator('.day-group .row').count();

  await page.fill('#title', 'Swimming lesson');
  await page.selectOption('#category', 'sport');
  await page.fill('#date', '2026-07-17');
  await page.fill('#time', '15:45');
  await page.fill('#who', 'Max');
  await page.click('[data-submit]');

  await page.waitForFunction((n) => document.querySelectorAll('.day-group .row').length === n + 1, before, { timeout: 8000 });
  check('adding an item puts it in the list', (await page.locator('.day-group .row').count()) === before + 1);
  check('the form clears ready for the next one', (await page.inputValue('#title')) === '');

  const added = page.locator('.row', { hasText: 'Swimming lesson' }).first();
  check('the new item shows its details', (await added.innerText()).includes('3:45pm'));
  check('and who it is for', (await added.innerText()).includes('Max'));

  // Tick it off.
  await added.locator('button', { hasText: 'Done' }).click();
  await page.waitForSelector('.row.is-done:has-text("Swimming lesson")', { timeout: 8000 });
  check('Done greys the row out rather than removing it', true);
  check('and the row is still there', (await page.locator('.row', { hasText: 'Swimming lesson' }).count()) === 1);

  // A calendar row can be ticked off too, without writing to the calendar.
  const calendarRow = page.locator('.row.read-only', { hasText: 'Ortho' }).first();
  check('the calendar entry appears on the phone too', (await calendarRow.count()) === 1);
  check('it offers no Edit, because the calendar owns it', (await calendarRow.locator('button', { hasText: 'Edit' }).count()) === 0);
  await calendarRow.locator('button', { hasText: 'Done' }).click();
  await page.waitForSelector('.row.read-only.is-done:has-text("Ortho")', { timeout: 8000 });
  check('a calendar entry can be ticked off', true);

  // Edit it.
  await page.locator('.row', { hasText: 'Swimming - moved' }).first().count().catch(() => {});
  await added.locator('button', { hasText: 'Edit' }).click();
  check('editing loads the item into the form', (await page.inputValue('#title')) === 'Swimming lesson');
  await page.fill('#title', 'Swimming - moved');
  await page.click('[data-submit]');
  await page.waitForSelector('.row:has-text("Swimming - moved")', { timeout: 5000 });
  check('the edit saves', (await page.locator('.row', { hasText: 'Swimming - moved' }).count()) === 1);

  // Week navigation.
  await page.click('[data-next]');
  check('next week moves the range on', (await text(page, '[data-week-range]')) === '20 – 26 Jul 2026');
  check('a "back to this week" button appears', await page.locator('[data-today]').isVisible());
  await page.click('[data-today]');
  check('and returns to this week', (await text(page, '[data-week-range]')) === '13 – 19 Jul 2026');

  // Validation.
  await page.click('[data-details]').catch(() => {});
  if (await page.locator('[data-form]').isHidden()) await page.click('[data-details]');
  await page.fill('#title', '   ');
  await page.click('[data-submit]');
  check('an empty title is refused', (await text(page, '[data-message]')).includes('Give it a name'));

  const noHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  check('the page does not scroll sideways on a phone', noHorizontalScroll);

  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'phone.png'), fullPage: true });
  await page.close();
}

async function testQuickAdd(context) {
  console.log('\nThe quick-add box');
  const { page } = await preparePage(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.day-group .row', { timeout: 5000 });

  // It shows what it understood before anything is saved.
  await page.fill('#quick', 'soccer thu 4pm lili');
  await page.waitForFunction(() => document.querySelector('[data-understood]').textContent.trim().length > 0);
  const understood = await text(page, '[data-understood]');
  check('it says which row it picked', understood.toLowerCase().includes('sport'), understood);
  check('it says which day it understood', understood.includes('Thursday'), understood);
  check('it says the time it understood', understood.includes('4pm'), understood);
  check('it says who it is for', understood.includes('Lili'), understood);

  const before = await page.locator('.day-group .row').count();
  await page.click('[data-quick-submit]');
  await page.waitForFunction((n) => document.querySelectorAll('.day-group .row').length === n + 1, before, { timeout: 8000 });

  const added = page.locator('.row', { hasText: 'soccer' }).first();
  const addedText = (await added.innerText()).replace(/\s+/g, ' ');
  check('one line becomes a full board item', addedText.includes('Sport') && addedText.includes('4pm') && addedText.includes('Lili'), addedText);
  check('the box clears ready for the next one', (await page.inputValue('#quick')) === '');

  // Nothing typed is ever silently lost.
  await page.fill('#quick', 'home late');
  await page.click('[data-quick-submit]');
  await page.waitForSelector('.row:has-text("home late")', { timeout: 8000 });
  check('a bare note still lands somewhere sensible', (await page.locator('.row', { hasText: 'home late' }).count()) === 1);

  await page.close();
}

async function testLegacyRedirect(context) {
  console.log('\nOld bookmarks');
  const { page } = await preparePage(context);

  await page.goto(`${BASE}/mobile-update.html`, { waitUntil: 'networkidle' });
  check('the old phone URL lands on the new one', new URL(page.url()).pathname === '/add', page.url());

  await page.goto(`${BASE}/tv-display.html`, { waitUntil: 'networkidle' });
  check('the old TV URL lands on the board', new URL(page.url()).pathname === '/', page.url());

  await page.close();
}

const server = await startServer();
// This container ships one Chromium build, which may not be the one the
// installed Playwright expects; point at it directly when it is there.
const executablePath = existsSync(CHROMIUM) ? CHROMIUM : undefined;
const browser = await chromium.launch({ executablePath });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await testBoard(context);
  await testBoardResilience(context);
  await testNoCalendars(context);
  await testPhone(context);
  await testQuickAdd(context);
  await testLegacyRedirect(context);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
