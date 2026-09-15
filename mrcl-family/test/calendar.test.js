import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchCalendarItems, normaliseFeeds, proxyUrl } from '../public/js/calendar.js';
import { buildWeek } from '../public/js/week.js';

const days = buildWeek(new Date(2026, 6, 15), { weekStartsOn: 1 });

const FEED = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:soccer-1',
  'SUMMARY:Soccer',
  'DTSTART:20260716T160000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('normaliseFeeds accepts strings and objects, and drops junk', () => {
  assert.deepEqual(normaliseFeeds(['https://example.com/a.ics']), [
    { url: 'https://example.com/a.ics', category: 'appointment', label: '' },
  ]);
  assert.deepEqual(normaliseFeeds([{ url: 'https://e/b.ics', category: 'sport', label: 'Ruby' }]), [
    { url: 'https://e/b.ics', category: 'sport', label: 'Ruby' },
  ]);
  assert.deepEqual(normaliseFeeds([null, '', '   ', { nope: 1 }]), []);
  assert.deepEqual(normaliseFeeds(undefined), []);
});

test('proxyUrl escapes the feed address', () => {
  assert.equal(proxyUrl('https://e/a.ics?x=1&y=2'), '/api/calendar?url=https%3A%2F%2Fe%2Fa.ics%3Fx%3D1%26y%3D2');
});

test('fetchCalendarItems returns board-shaped, read-only items', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => FEED });
  const items = await fetchCalendarItems(days, { fetchImpl, calendars: ['https://e/a.ics'] });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Soccer');
  assert.equal(items[0].date, '2026-07-16');
  assert.equal(items[0].time, '16:00');
  assert.equal(items[0].category, 'appointment');
  assert.equal(items[0].readOnly, true);
  assert.equal(items[0].done, false);
});

test('a feed can be routed to a different row of the board', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => FEED });
  const items = await fetchCalendarItems(days, {
    fetchImpl,
    calendars: [{ url: 'https://e/a.ics', category: 'sport', label: 'Ruby' }],
  });
  assert.equal(items[0].category, 'sport');
  assert.equal(items[0].who, 'Ruby');
});

test('no configured feeds means no fetch at all', async () => {
  const boom = () => {
    throw new Error('should not be called');
  };
  assert.deepEqual(await fetchCalendarItems(days, { fetchImpl: boom, calendars: [] }), []);
});

test('one broken feed does not take the others down', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('bad')) throw new Error('offline');
    return { ok: true, text: async () => FEED };
  };
  const items = await fetchCalendarItems(days, {
    fetchImpl,
    calendars: ['https://e/bad.ics', 'https://e/good.ics'],
  });
  assert.equal(items.length, 1);
});

test('a non-ok response yields nothing rather than throwing', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403 });
  assert.deepEqual(await fetchCalendarItems(days, { fetchImpl, calendars: ['https://e/a.ics'] }), []);
});

test('ids are stable across fetches so re-renders do not flicker', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => FEED });
  const first = await fetchCalendarItems(days, { fetchImpl, calendars: ['https://e/a.ics'] });
  const second = await fetchCalendarItems(days, { fetchImpl, calendars: ['https://e/a.ics'] });
  assert.equal(first[0].id, second[0].id);
});
