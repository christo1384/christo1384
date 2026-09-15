import test from 'node:test';
import assert from 'node:assert/strict';

import { describeDraft, parseDate, parseQuickAdd, parseTime } from '../public/js/quickadd.js';
import { toISODate } from '../public/js/week.js';

const NAMES = ['Lili', 'Ruby', 'Max', 'Chris'];
// Wednesday 15 July 2026.
const TODAY = new Date(2026, 6, 15);
const opts = { today: TODAY, names: NAMES };

test('parseTime reads the ways people actually write times', () => {
  assert.equal(parseTime('soccer 4pm').time, '16:00');
  assert.equal(parseTime('ortho 8.20am').time, '08:20');
  assert.equal(parseTime('dentist 9:15am').time, '09:15');
  assert.equal(parseTime('pickup 16:30').time, '16:30');
  assert.equal(parseTime('lunch 12pm').time, '12:00');
  assert.equal(parseTime('midnight 12am').time, '00:00');
});

test('parseTime leaves the rest of the line behind', () => {
  assert.equal(parseTime('soccer 4pm lili').rest, 'soccer lili');
  assert.deepEqual(parseTime('no time here'), { time: '', rest: 'no time here' });
});

test('parseTime rejects nonsense rather than guessing', () => {
  assert.equal(parseTime('thing 25:99').time, '');
  assert.equal(parseTime('thing 19pm').time, '');
});

test('parseDate handles today, tonight and tomorrow', () => {
  assert.equal(toISODate(parseDate('bins tonight', TODAY).date), '2026-07-15');
  assert.equal(toISODate(parseDate('bins today', TODAY).date), '2026-07-15');
  assert.equal(toISODate(parseDate('bins tomorrow', TODAY).date), '2026-07-16');
  assert.equal(parseDate('bins tomorrow', TODAY).rest, 'bins');
});

test('a weekday means the next one, counting today', () => {
  // Today is Wednesday.
  assert.equal(toISODate(parseDate('soccer thu', TODAY).date), '2026-07-16');
  assert.equal(toISODate(parseDate('soccer wed', TODAY).date), '2026-07-15');
  assert.equal(toISODate(parseDate('soccer tue', TODAY).date), '2026-07-21');
});

test('"next thursday" skips the one this week', () => {
  assert.equal(toISODate(parseDate('soccer next thu', TODAY).date), '2026-07-23');
});

test('parseDate reads written dates both ways round', () => {
  assert.equal(toISODate(parseDate('zoo 16 oct', TODAY).date), '2026-10-16');
  assert.equal(toISODate(parseDate('zoo oct 16', TODAY).date), '2026-10-16');
  assert.equal(toISODate(parseDate('zoo 16th october', TODAY).date), '2026-10-16');
});

test('a written date that has passed rolls to next year', () => {
  assert.equal(toISODate(parseDate('party 3 mar', TODAY).date), '2027-03-03');
});

test('parseDate reads numeric dates day-first, as New Zealand writes them', () => {
  assert.equal(toISODate(parseDate('zoo 16/10', TODAY).date), '2026-10-16');
  assert.equal(toISODate(parseDate('zoo 16/10/27', TODAY).date), '2027-10-16');
  assert.equal(toISODate(parseDate('zoo 1-8', TODAY).date), '2026-08-01');
});

test('parseDate returns null for an impossible date instead of rolling over', () => {
  assert.equal(parseDate('thing 31/02', TODAY).date, null);
  assert.equal(parseDate('thing 45/13', TODAY).date, null);
});

test('parseDate returns null when there is no date at all', () => {
  assert.deepEqual(parseDate('just a thing', TODAY), { date: null, rest: 'just a thing' });
});

test('the headline case: "soccer thu 4pm lili"', () => {
  const draft = parseQuickAdd('soccer thu 4pm lili', opts);
  assert.equal(draft.title, 'soccer');
  assert.equal(draft.category, 'sport');
  assert.equal(draft.who, 'Lili');
  assert.equal(draft.date, '2026-07-16');
  assert.equal(draft.time, '16:00');
  assert.deepEqual(draft.understood, { date: true, time: true, who: true });
});

test('a bare note gets today and no time', () => {
  const draft = parseQuickAdd('home late', opts);
  assert.equal(draft.title, 'home late');
  assert.equal(draft.date, '2026-07-15');
  assert.equal(draft.time, '');
  assert.deepEqual(draft.understood, { date: false, time: false, who: false });
});

test('the row is classified from the whole line, not the leftovers', () => {
  // "dinner" is consumed into the title; the row still has to be dinner.
  assert.equal(parseQuickAdd('dinner lasagne fri', opts).category, 'dinner');
  assert.equal(parseQuickAdd('bins out tonight', opts).category, 'chore');
  assert.equal(parseQuickAdd('lili ortho 8.20am 27 oct', opts).category, 'appointment');
});

test('a real calendar-style entry parses end to end', () => {
  const draft = parseQuickAdd('lili ortho 8.20am 27 oct', opts);
  assert.equal(draft.who, 'Lili');
  assert.equal(draft.title, 'ortho');
  assert.equal(draft.date, '2026-10-27');
  assert.equal(draft.time, '08:20');
});

test('nothing is ever silently dropped', () => {
  const draft = parseQuickAdd('some entirely unparseable thing', opts);
  assert.equal(draft.title, 'some entirely unparseable thing');
  assert.equal(draft.date, '2026-07-15');
});

test('empty input is handled without throwing', () => {
  const draft = parseQuickAdd('', opts);
  assert.equal(draft.title, '');
  assert.equal(draft.date, '2026-07-15');
  assert.equal(parseQuickAdd(undefined, opts).title, '');
});

test('defaultDate is used when the line carries no date', () => {
  const draft = parseQuickAdd('home late', { ...opts, defaultDate: '2026-08-01' });
  assert.equal(draft.date, '2026-08-01');
  // An explicit date in the line still wins.
  assert.equal(parseQuickAdd('home late fri', { ...opts, defaultDate: '2026-08-01' }).date, '2026-07-17');
});

test('describeDraft summarises what was understood', () => {
  assert.equal(
    describeDraft({ date: '2026-07-16', time: '16:00', who: 'Lili' }, { dayName: 'Thursday' }),
    'Thursday · 16:00 · for Lili',
  );
  assert.equal(describeDraft({ date: '2026-07-16', time: '', who: '' }, { dayName: 'Thursday' }), 'Thursday');
});
