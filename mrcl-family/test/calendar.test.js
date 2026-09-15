import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchCalendarItems, feedUrl, listFeeds } from '../public/js/calendar.js';
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

test('feeds are addressed by index, never by URL', () => {
  // The browser must never be handed a secret iCal address.
  assert.equal(feedUrl(0), '/api/calendar?feed=0');
  assert.equal(feedUrl(2), '/api/calendar?feed=2');
});

test('listFeeds returns the descriptors the server offers', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ calendars: [{ id: 0, category: '', label: '' }] }),
  });
  assert.deepEqual(await listFeeds({ fetchImpl }), [{ id: 0, category: '', label: '' }]);
});

test('listFeeds returns nothing rather than throwing when the server is down', async () => {
  assert.deepEqual(await listFeeds({ fetchImpl: async () => ({ ok: false }) }), []);
  assert.deepEqual(
    await listFeeds({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }),
    [],
  );
});

test('fetchCalendarItems returns board-shaped, read-only items', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => FEED });
  const items = await fetchCalendarItems(days, { fetchImpl, feeds: [{ id: 0, category: '', label: '' }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Soccer');
  assert.equal(items[0].date, '2026-07-16');
  assert.equal(items[0].time, '16:00');
  // "Soccer" classifies itself into the sports row with no configuration.
  assert.equal(items[0].category, 'sport');
  assert.equal(items[0].readOnly, true);
  assert.equal(items[0].done, false);
});

test('a family calendar entry classifies itself and names the person', async () => {
  const feed = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:ortho-1',
    'SUMMARY:Lili Ortho 8.20am',
    'DTSTART:20260716T082000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const fetchImpl = async () => ({ ok: true, text: async () => feed });
  const items = await fetchCalendarItems(days, {
    fetchImpl,
    feeds: [{ id: 0, category: '', label: '' }],
    names: ['Lili', 'Ruby'],
  });
  assert.equal(items[0].category, 'appointment');
  assert.equal(items[0].who, 'Lili');
  assert.equal(items[0].title, 'Ortho');
  assert.equal(items[0].time, '08:20');
});

test('a feed can be routed to a different row of the board', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => FEED });
  const items = await fetchCalendarItems(days, {
    fetchImpl,
    feeds: [{ id: 0, category: 'sport', label: 'Ruby' }],
  });
  assert.equal(items[0].category, 'sport');
  assert.equal(items[0].who, 'Ruby');
});

test('no configured feeds means no fetch at all', async () => {
  const boom = () => {
    throw new Error('should not be called');
  };
  assert.deepEqual(await fetchCalendarItems(days, { fetchImpl: boom, feeds: [] }), []);
});

test('one broken feed does not take the others down', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('feed=0')) throw new Error('offline');
    return { ok: true, text: async () => FEED };
  };
  const items = await fetchCalendarItems(days, {
    fetchImpl,
    feeds: [{ id: 0 }, { id: 1 }],
  });
  assert.equal(items.length, 1);
});

test('a non-ok response yields nothing rather than throwing', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403 });
  assert.deepEqual(await fetchCalendarItems(days, { fetchImpl, feeds: [{ id: 0 }] }), []);
});

test('ids are stable across fetches so re-renders do not flicker', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => FEED });
  const first = await fetchCalendarItems(days, { fetchImpl, feeds: [{ id: 0 }] });
  const second = await fetchCalendarItems(days, { fetchImpl, feeds: [{ id: 0 }] });
  assert.equal(first[0].id, second[0].id);
});
