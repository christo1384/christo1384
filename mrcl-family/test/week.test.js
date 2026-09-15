import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addWeeks,
  bandItems,
  buildWeek,
  compareItems,
  formatTime,
  fromISODate,
  groupByCategoryAndDay,
  isLeapYear,
  itemsForWeek,
  placeAnnual,
  startOfWeek,
  toISODate,
  weekLabel,
} from '../public/js/week.js';

const d = (y, m, day) => new Date(y, m - 1, day);

test('toISODate uses local time, not UTC', () => {
  // 1 Jan 00:30 local is still 31 Dec in UTC for NZ. The board must say 1 Jan.
  assert.equal(toISODate(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
  assert.equal(toISODate(new Date(2026, 11, 31, 23, 45)), '2026-12-31');
});

test('fromISODate round-trips and rejects impossible dates', () => {
  assert.equal(toISODate(fromISODate('2026-07-18')), '2026-07-18');
  assert.equal(fromISODate('2026-02-31'), null);
  assert.equal(fromISODate('2026-13-01'), null);
  assert.equal(fromISODate('not a date'), null);
  assert.equal(fromISODate(''), null);
  assert.equal(fromISODate(undefined), null);
});

test('startOfWeek honours the configured first day', () => {
  // Wednesday 15 July 2026.
  const wed = d(2026, 7, 15);
  assert.equal(toISODate(startOfWeek(wed, 1)), '2026-07-13'); // Monday
  assert.equal(toISODate(startOfWeek(wed, 0)), '2026-07-12'); // Sunday
});

test('startOfWeek is a no-op on the first day itself', () => {
  const mon = d(2026, 7, 13);
  assert.equal(toISODate(startOfWeek(mon, 1)), '2026-07-13');
  const sun = d(2026, 7, 12);
  assert.equal(toISODate(startOfWeek(sun, 0)), '2026-07-12');
});

test('buildWeek returns seven consecutive days and marks today', () => {
  const days = buildWeek(d(2026, 7, 15), { weekStartsOn: 1, today: d(2026, 7, 15) });
  assert.equal(days.length, 7);
  assert.deepEqual(
    days.map((x) => x.iso),
    ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'],
  );
  assert.deepEqual(days.map((x) => x.short), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(days.filter((x) => x.isToday).length, 1);
  assert.equal(days.find((x) => x.isToday).iso, '2026-07-15');
  assert.deepEqual(days.filter((x) => x.isWeekend).map((x) => x.short), ['Sat', 'Sun']);
});

test('buildWeek marks no day as today when today is elsewhere', () => {
  const days = buildWeek(d(2026, 7, 15), { weekStartsOn: 1, today: d(2026, 9, 1) });
  assert.equal(days.filter((x) => x.isToday).length, 0);
});

test('a week that spans a month and a year still builds', () => {
  const days = buildWeek(d(2026, 12, 31), { weekStartsOn: 1, today: d(2026, 12, 31) });
  assert.equal(days[0].iso, '2026-12-28');
  assert.equal(days[6].iso, '2027-01-03');
});

test('addWeeks crosses daylight saving without drifting', () => {
  // NZDT starts late September. Stepping a week must stay on the same weekday.
  const before = d(2026, 9, 21);
  const after = addWeeks(before, 1);
  assert.equal(toISODate(after), '2026-09-28');
  assert.equal(after.getDay(), before.getDay());
  assert.equal(toISODate(addWeeks(before, -1)), '2026-09-14');
});

test('weekLabel collapses repeated month and year', () => {
  assert.equal(weekLabel(buildWeek(d(2026, 7, 15), { weekStartsOn: 1 })), '13 – 19 Jul 2026');
  assert.equal(weekLabel(buildWeek(d(2026, 6, 30), { weekStartsOn: 1 })), '29 Jun – 5 Jul 2026');
  assert.equal(weekLabel(buildWeek(d(2026, 12, 31), { weekStartsOn: 1 })), '28 Dec 2026 – 3 Jan 2027');
});

test('formatTime renders board-friendly times', () => {
  assert.equal(formatTime('16:30'), '4:30pm');
  assert.equal(formatTime('09:00'), '9am');
  assert.equal(formatTime('00:00'), '12am');
  assert.equal(formatTime('12:00'), '12pm');
  assert.equal(formatTime('12:05'), '12:05pm');
  assert.equal(formatTime('23:59'), '11:59pm');
  assert.equal(formatTime(''), '');
  assert.equal(formatTime('25:00'), '');
  assert.equal(formatTime('nope'), '');
});

test('compareItems puts timed first, then untimed, with done last', () => {
  const items = [
    { title: 'Zebra', time: '' },
    { title: 'Soccer', time: '16:00' },
    { title: 'Apple', time: '' },
    { title: 'Dentist', time: '09:15' },
    { title: 'Early bird', time: '06:00', done: true },
  ];
  const sorted = [...items].sort(compareItems);
  assert.deepEqual(sorted.map((i) => i.title), ['Dentist', 'Soccer', 'Apple', 'Zebra', 'Early bird']);
});

test('placeAnnual moves a birthday onto this week and counts the years', () => {
  const days = buildWeek(d(2026, 7, 15), { weekStartsOn: 1 });
  const placed = placeAnnual({ title: 'Ruby', date: '2017-07-16', annual: true }, days);
  assert.equal(placed.date, '2026-07-16');
  assert.equal(placed.annualYears, 9);
});

test('placeAnnual returns null when the birthday is not in the week', () => {
  const days = buildWeek(d(2026, 7, 15), { weekStartsOn: 1 });
  assert.equal(placeAnnual({ date: '2017-03-02', annual: true }, days), null);
  assert.equal(placeAnnual({ date: 'rubbish', annual: true }, days), null);
});

test('placeAnnual suppresses a nonsense age but still shows the day', () => {
  const days = buildWeek(d(2026, 7, 15), { weekStartsOn: 1 });
  const placed = placeAnnual({ title: 'Placeholder', date: '2026-07-16', annual: true }, days);
  assert.equal(placed.date, '2026-07-16');
  assert.equal(placed.annualYears, null);
});

test('29 February falls back to 28 February in a common year', () => {
  assert.equal(isLeapYear(2028), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);

  const common = buildWeek(d(2026, 2, 24), { weekStartsOn: 1 });
  assert.equal(placeAnnual({ date: '2000-02-29', annual: true }, common).date, '2026-02-28');

  const leap = buildWeek(d(2028, 2, 28), { weekStartsOn: 1 });
  assert.equal(placeAnnual({ date: '2000-02-29', annual: true }, leap).date, '2028-02-29');
});

test('itemsForWeek keeps in-week items and drops the rest', () => {
  const days = buildWeek(d(2026, 7, 15), { weekStartsOn: 1 });
  const items = [
    { id: 'a', title: 'Soccer', category: 'sport', date: '2026-07-16' },
    { id: 'b', title: 'Last week', category: 'chore', date: '2026-07-06' },
    { id: 'c', title: 'Ruby', category: 'birthday', date: '2017-07-16', annual: true },
    { id: 'd', title: 'Other birthday', category: 'birthday', date: '2017-01-01', annual: true },
  ];
  const kept = itemsForWeek(items, days);
  assert.deepEqual(kept.map((i) => i.id).sort(), ['a', 'c']);
});

test('groupByCategoryAndDay buckets and sorts each cell', () => {
  const items = [
    { title: 'Late', category: 'sport', date: '2026-07-16', time: '17:00' },
    { title: 'Early', category: 'sport', date: '2026-07-16', time: '08:00' },
    { title: 'Bins', category: 'chore', date: '2026-07-16' },
  ];
  const grouped = groupByCategoryAndDay(items);
  assert.deepEqual(grouped.sport['2026-07-16'].map((i) => i.title), ['Early', 'Late']);
  assert.deepEqual(grouped.chore['2026-07-16'].map((i) => i.title), ['Bins']);
  assert.equal(grouped.dinner, undefined);
});

test('bandItems runs left to right across the week', () => {
  const days = buildWeek(d(2026, 7, 15), { weekStartsOn: 1 });
  const items = [
    { title: 'Friday trip', category: 'out', date: '2026-07-17' },
    { title: 'Monday trip', category: 'out', date: '2026-07-13' },
    { title: 'Not a band item', category: 'chore', date: '2026-07-13' },
  ];
  assert.deepEqual(bandItems(items, 'out', days).map((i) => i.title), ['Monday trip', 'Friday trip']);
});
