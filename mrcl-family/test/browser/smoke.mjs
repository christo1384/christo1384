#!/usr/bin/env node
// Drives both pages in a real browser against a stubbed Firebase, so the whole
// render path is exercised: grid placement, done styling, bands, the phone
// form, and the failure states.
//
//   node test/browser/smoke.mjs [--screenshots <dir>]

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
const fakeDir = join(here, 'fake');
const PORT = 8099;
const BASE = `http://localhost:${PORT}`;
const SDK_PREFIX = 'https://www.gstatic.com/firebasejs/10.12.2/';
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

const ITEMS = [
  { id: 'i1', title: 'Soccer practice', category: 'sport', date: '2026-07-16', time: '16:00', who: 'Ruby' },
  { id: 'i2', title: 'Lasagne', category: 'dinner', date: '2026-07-16', time: '' },
  { id: 'i3', title: 'Bins out', category: 'chore', date: '2026-07-14', time: '', done: true },
  { id: 'i4', title: 'Dentist', category: 'appointment', date: '2026-07-15', time: '09:15' },
  { id: 'i5', title: 'Ruby', category: 'birthday', date: '2017-07-16', annual: true },
  { id: 'i6', title: 'Nana visiting', category: 'out', date: '2026-07-18' },
  { id: 'i7', title: 'Out of range', category: 'chore', date: '2026-09-01' },
];

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

/** Serve the fake SDK, freeze the clock, and seed the stubbed store. */
async function preparePage(context, { items = ITEMS, config = 'valid' } = {}) {
  const page = await context.newPage();

  await page.route(`${SDK_PREFIX}*`, async (route) => {
    const name = route.request().url().slice(SDK_PREFIX.length);
    const body = await readFile(join(fakeDir, name), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  });

  const injected =
    config === 'valid'
      ? {
          boardTitle: 'The MRCL family Week',
          weekStartsOn: 1,
          firebase: { apiKey: 'k', authDomain: 'a', projectId: 'p', appId: 'x' },
          weather: { enabled: false },
          calendars: [],
        }
      : {};

  // Stand in for what tools/build-config.mjs writes at deploy time, so the
  // real configuration mechanism is what is under test.
  await page.route('**/config.generated.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: `window.__MRCL__ = ${JSON.stringify(injected)};`,
    }),
  );

  await page.addInitScript(
    ([itemsJSON, now]) => {
      globalThis.__TEST_ITEMS__ = JSON.parse(itemsJSON);

      // Freeze "now" so the board always builds the same week.
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
    },
    [JSON.stringify(items), FIXED_NOW],
  );

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  return { page, errors };
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
  check('status line counts the week', (await text(page, '[data-status]')).includes('6 things on this week'));

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
  console.log('\nThe board when Firebase cannot load');
  const { page } = await preparePage(context);
  // Take the CDN away after the fake route is registered.
  await page.route(`${SDK_PREFIX}*`, (route) => route.abort());
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  check('the board still renders its grid', (await page.locator('.board .cell').count()) === 42);
  const status = await text(page, '[data-status]');
  check('and says what is wrong', status.includes('Could not load Firebase'), status);
  await page.close();
}

async function testUnconfigured(context) {
  console.log('\nA deploy with no Firebase configuration');
  const { page } = await preparePage(context, { config: 'empty' });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  check('the setup panel is shown', await page.locator('[data-setup]').isVisible());
  check('the board is hidden', await page.locator('[data-app]').isHidden());
  const missing = await text(page, '[data-setup-missing]');
  check('it names every missing key', missing.includes('apiKey') && missing.includes('appId'), missing);
  await page.close();
}

async function testPhone(context) {
  console.log('\nThe phone page (/add)');
  const { page, errors } = await preparePage(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.day-group .row', { timeout: 5000 });

  check('no page errors', errors.length === 0, errors.join(' | '));
  check('there is no setup screen at all', await page.locator('[data-setup]').isHidden());
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

  await page.waitForFunction((n) => document.querySelectorAll('.day-group .row').length === n + 1, before);
  check('adding an item puts it in the list', (await page.locator('.day-group .row').count()) === before + 1);
  check('the form confirms', (await text(page, '[data-message]')).includes('on the kitchen board'));
  check('the form clears ready for the next one', (await page.inputValue('#title')) === '');

  const added = page.locator('.row', { hasText: 'Swimming lesson' }).first();
  check('the new item shows its details', (await added.innerText()).includes('3:45pm'));
  check('and who it is for', (await added.innerText()).includes('Max'));

  const stored = await page.evaluate(() => globalThis.__TEST_STORE__.all().find((i) => i.title === 'Swimming lesson'));
  check('it is stored in the canonical shape', stored.date === '2026-07-17' && stored.time === '15:45' && stored.category === 'sport');

  // Tick it off.
  await added.locator('button', { hasText: 'Done' }).click();
  await page.waitForFunction(
    () => globalThis.__TEST_STORE__.all().find((i) => i.title === 'Swimming lesson')?.done === true,
  );
  check('Done greys the row out rather than removing it', await added.evaluate((el) => el.classList.contains('is-done')));
  check('and the row is still there', (await page.locator('.row', { hasText: 'Swimming lesson' }).count()) === 1);

  // Edit it.
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
  await testUnconfigured(context);
  await testPhone(context);
  await testLegacyRedirect(context);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
