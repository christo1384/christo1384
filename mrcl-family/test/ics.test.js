import test from 'node:test';
import assert from 'node:assert/strict';

import {
  expandEvent,
  occurrencesInRange,
  parseDateTime,
  parseICS,
  parseLine,
  parseRRule,
  unescapeText,
  unfold,
} from '../public/js/ics.js';
import { toISODate } from '../public/js/week.js';

const d = (y, m, day) => new Date(y, m - 1, day);

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

test('unfold rejoins RFC 5545 continuation lines', () => {
  assert.equal(unfold('SUMMARY:Soccer pra\r\n ctice'), 'SUMMARY:Soccer practice');
  assert.equal(unfold('A:1\r\nB:2'), 'A:1\nB:2');
});

test('unescapeText handles escaped punctuation and newlines', () => {
  assert.equal(unescapeText('Dinner\\, then bed'), 'Dinner, then bed');
  assert.equal(unescapeText('Line one\\nLine two'), 'Line one Line two');
  assert.equal(unescapeText('Back\\\\slash'), 'Back\\slash');
});

test('parseLine splits name, params and value', () => {
  assert.deepEqual(parseLine('SUMMARY:Soccer'), { name: 'SUMMARY', params: {}, value: 'Soccer' });
  assert.deepEqual(parseLine('DTSTART;VALUE=DATE:20260716'), {
    name: 'DTSTART',
    params: { VALUE: 'DATE' },
    value: '20260716',
  });
  assert.equal(parseLine('no-colon-here'), null);
});

test('parseLine is not fooled by a colon inside a quoted parameter', () => {
  const parsed = parseLine('DTSTART;TZID="Pacific:Auckland":20260716T093000');
  assert.equal(parsed.name, 'DTSTART');
  assert.equal(parsed.params.TZID, 'Pacific:Auckland');
  assert.equal(parsed.value, '20260716T093000');
});

test('parseDateTime reads all-day, floating and UTC forms', () => {
  const allDay = parseDateTime('20260716');
  assert.equal(toISODate(allDay.date), '2026-07-16');
  assert.equal(allDay.allDay, true);

  const floating = parseDateTime('20260716T093000');
  assert.equal(toISODate(floating.date), '2026-07-16');
  assert.equal(floating.date.getHours(), 9);
  assert.equal(floating.allDay, false);

  const utc = parseDateTime('20260716T093000Z');
  assert.equal(utc.date.getUTCHours(), 9);

  assert.equal(parseDateTime('garbage').date, null);
});

test('parseRRule reads the parts we support and ignores ordinals on BYDAY', () => {
  const rule = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=6');
  assert.equal(rule.freq, 'WEEKLY');
  assert.equal(rule.interval, 2);
  assert.deepEqual(rule.byday, ['TU', 'TH']);
  assert.equal(rule.count, 6);

  assert.deepEqual(parseRRule('FREQ=MONTHLY;BYDAY=2FR').byday, ['FR']);
  assert.equal(parseRRule('nonsense'), null);
  assert.equal(parseRRule('FREQ=WEEKLY').interval, 1);
});

test('parseICS reads a simple timed event', () => {
  const events = parseICS(
    wrap(
      [
        'BEGIN:VEVENT',
        'UID:abc123',
        'SUMMARY:Dentist',
        'LOCATION:Main St',
        'DTSTART:20260716T093000',
        'DTEND:20260716T100000',
        'END:VEVENT',
      ].join('\r\n'),
    ),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Dentist');
  assert.equal(events[0].location, 'Main St');
  assert.equal(events[0].allDay, false);
});

test('parseICS drops cancelled and untitled events', () => {
  const events = parseICS(
    wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Gone',
        'STATUS:CANCELLED',
        'DTSTART:20260716T093000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART:20260716T093000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Kept',
        'DTSTART:20260716T093000',
        'END:VEVENT',
      ].join('\r\n'),
    ),
  );
  assert.deepEqual(events.map((e) => e.title), ['Kept']);
});

test('a one-off event only appears inside the range', () => {
  const [event] = parseICS(
    wrap(['BEGIN:VEVENT', 'SUMMARY:Dentist', 'DTSTART:20260716T093000', 'END:VEVENT'].join('\r\n')),
  );
  assert.deepEqual(
    expandEvent(event, d(2026, 7, 13), d(2026, 7, 19)).map((o) => `${o.date} ${o.time}`),
    ['2026-07-16 09:30'],
  );
  assert.deepEqual(expandEvent(event, d(2026, 8, 1), d(2026, 8, 7)), []);
});

test('an all-day event carries no time', () => {
  const [event] = parseICS(
    wrap(
      ['BEGIN:VEVENT', 'SUMMARY:Teacher only day', 'DTSTART;VALUE=DATE:20260716', 'END:VEVENT'].join('\r\n'),
    ),
  );
  const [occurrence] = expandEvent(event, d(2026, 7, 13), d(2026, 7, 19));
  assert.equal(occurrence.time, '');
  assert.equal(occurrence.allDay, true);
});

test('weekly BYDAY produces every listed weekday', () => {
  const [event] = parseICS(
    wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Soccer',
        'DTSTART:20260714T160000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU,TH',
        'END:VEVENT',
      ].join('\r\n'),
    ),
  );
  // Week of Mon 13 July 2026: Tue 14 and Thu 16.
  assert.deepEqual(
    expandEvent(event, d(2026, 7, 13), d(2026, 7, 19)).map((o) => o.date),
    ['2026-07-14', '2026-07-16'],
  );
  // And still running a month later.
  assert.deepEqual(
    expandEvent(event, d(2026, 8, 10), d(2026, 8, 16)).map((o) => o.date),
    ['2026-08-11', '2026-08-13'],
  );
});

test('weekly INTERVAL=2 skips the off weeks', () => {
  const [event] = parseICS(
    wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Fortnightly',
        'DTSTART:20260714T160000',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
        'END:VEVENT',
      ].join('\r\n'),
    ),
  );
  assert.deepEqual(expandEvent(event, d(2026, 7, 13), d(2026, 7, 19)).map((o) => o.date), ['2026-07-14']);
  assert.deepEqual(expandEvent(event, d(2026, 7, 20), d(2026, 7, 26)), []);
  assert.deepEqual(expandEvent(event, d(2026, 7, 27), d(2026, 8, 2)).map((o) => o.date), ['2026-07-28']);
});

test('COUNT is counted from the start, not from the range', () => {
  const [event] = parseICS(
    wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Three weeks only',
        'DTSTART:20260714T160000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3',
        'END:VEVENT',
      ].join('\r\n'),
    ),
  );
  assert.deepEqual(expandEvent(event, d(2026, 7, 27), d(2026, 8, 2)).map((o) => o.date), ['2026-07-28']);
  // The fourth Tuesday is past the count.
  assert.deepEqual(expandEvent(event, d(2026, 8, 3), d(2026, 8, 9)), []);
});

test('UNTIL stops the series', () => {
  const [event] = parseICS(
    wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Term time',
        'DTSTART:20260714T160000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20260728T000000Z',
        'END:VEVENT',
      ].join('\r\n'),
    ),
  );
  assert.equal(expandEvent(event, d(2026, 7, 27), d(2026, 8, 2)).length, 1);
  assert.equal(expandEvent(event, d(2026, 8, 3), d(2026, 8, 9)).length, 0);
});

test('EXDATE removes a single occurrence', () => {
  const [event] = parseICS(
    wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Soccer',
        'DTSTART:20260714T160000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'EXDATE:20260728T160000',
        'END:VEVENT',
      ].join('\r\n'),
    ),
  );
  assert.deepEqual(expandEvent(event, d(2026, 7, 27), d(2026, 8, 2)), []);
  assert.equal(expandEvent(event, d(2026, 8, 3), d(2026, 8, 9)).length, 1);
});

test('daily, monthly and yearly repeats land where expected', () => {
  const daily = parseICS(
    wrap(['BEGIN:VEVENT', 'SUMMARY:Pills', 'DTSTART:20260713T080000', 'RRULE:FREQ=DAILY', 'END:VEVENT'].join('\r\n')),
  )[0];
  assert.equal(expandEvent(daily, d(2026, 7, 13), d(2026, 7, 19)).length, 7);

  const monthly = parseICS(
    wrap(['BEGIN:VEVENT', 'SUMMARY:Rent', 'DTSTART:20260115T090000', 'RRULE:FREQ=MONTHLY', 'END:VEVENT'].join('\r\n')),
  )[0];
  assert.deepEqual(expandEvent(monthly, d(2026, 7, 13), d(2026, 7, 19)).map((o) => o.date), ['2026-07-15']);

  const yearly = parseICS(
    wrap(['BEGIN:VEVENT', 'SUMMARY:Anniversary', 'DTSTART:20200716T090000', 'RRULE:FREQ=YEARLY', 'END:VEVENT'].join('\r\n')),
  )[0];
  assert.deepEqual(expandEvent(yearly, d(2026, 7, 13), d(2026, 7, 19)).map((o) => o.date), ['2026-07-16']);
});

test('a monthly 31st skips the short months instead of rolling over', () => {
  const [event] = parseICS(
    wrap(['BEGIN:VEVENT', 'SUMMARY:Month end', 'DTSTART:20260131T090000', 'RRULE:FREQ=MONTHLY', 'END:VEVENT'].join('\r\n')),
  );
  // February 2026 has no 31st, so nothing should appear in early March.
  assert.deepEqual(expandEvent(event, d(2026, 3, 1), d(2026, 3, 7)), []);
  assert.deepEqual(expandEvent(event, d(2026, 3, 29), d(2026, 4, 4)).map((o) => o.date), ['2026-03-31']);
});

test('occurrencesInRange flattens a whole feed in date order', () => {
  const ics = wrap(
    [
      'BEGIN:VEVENT',
      'SUMMARY:Later',
      'DTSTART:20260717T090000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:Earlier',
      'DTSTART:20260714T160000',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'END:VEVENT',
    ].join('\r\n'),
  );
  assert.deepEqual(
    occurrencesInRange(ics, d(2026, 7, 13), d(2026, 7, 19)).map((o) => `${o.date} ${o.title}`),
    ['2026-07-14 Earlier', '2026-07-17 Later'],
  );
});

test('a malformed feed yields nothing rather than throwing', () => {
  assert.deepEqual(occurrencesInRange('', d(2026, 7, 13), d(2026, 7, 19)), []);
  assert.deepEqual(occurrencesInRange('total nonsense', d(2026, 7, 13), d(2026, 7, 19)), []);
  assert.deepEqual(occurrencesInRange(undefined, d(2026, 7, 13), d(2026, 7, 19)), []);
});
