// A small iCalendar (RFC 5545) reader: enough of it to put a Google Calendar
// feed on the board, including the repeating events a family calendar is
// mostly made of.
//
// Pure functions, no network — `calendar.js` does the fetching, this file does
// the parsing, and the Node tests import it directly.
//
// Timezone note: UTC timestamps (a trailing Z) are converted properly. Times
// carrying a TZID, and floating times with no zone at all, are read as local
// time. That is correct whenever the calendar and the kitchen TV are in the
// same timezone, which is the case here, and avoids shipping a timezone
// database to render a fridge board.

import { addDays, startOfDay, startOfWeek, toISODate } from './week.js';

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_ITERATIONS = 2000;

/** Undo RFC 5545 line folding, then normalise line endings. */
export function unfold(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

/** Unescape an iCalendar TEXT value. */
export function unescapeText(value) {
  return String(value ?? '')
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/**
 * 'DTSTART;TZID=Pacific/Auckland:20260716T093000'
 *   -> { name: 'DTSTART', params: { TZID: '...' }, value: '20260716T093000' }
 * Returns null for a line with no colon at all.
 */
export function parseLine(line) {
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const params = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

/**
 * An iCalendar DATE or DATE-TIME -> { date: Date, allDay: boolean }.
 * Returns { date: null } for anything malformed.
 */
export function parseDateTime(value, params = {}) {
  const raw = String(value ?? '').trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [y, m, d] = [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])];
    return { date: new Date(y, m - 1, d), allDay: true };
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!dateTime) return { date: null, allDay: false };

  const [y, mo, d, h, mi, s] = dateTime.slice(1, 7).map(Number);
  const isUTC = dateTime[7] === 'Z';
  const date = isUTC ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s);
  return { date, allDay: params.VALUE === 'DATE' };
}

/** 'FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2' -> a plain object. */
export function parseRRule(value) {
  const rule = { freq: null, interval: 1, count: null, until: null, byday: [], bymonthday: [], wkst: 'MO' };
  for (const part of String(value ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).toUpperCase();
    const val = part.slice(eq + 1);
    if (key === 'FREQ') rule.freq = val.toUpperCase();
    else if (key === 'INTERVAL') rule.interval = Math.max(1, Number(val) || 1);
    else if (key === 'COUNT') rule.count = Number(val) || null;
    else if (key === 'UNTIL') rule.until = parseDateTime(val).date;
    else if (key === 'WKST') rule.wkst = val.toUpperCase();
    else if (key === 'BYDAY') {
      // Strip any ordinal prefix ("2FR"); we only honour the weekday itself.
      rule.byday = val
        .split(',')
        .map((token) => token.trim().toUpperCase().replace(/^[+-]?\d+/, ''))
        .filter((token) => WEEKDAYS.includes(token));
    } else if (key === 'BYMONTHDAY') {
      rule.bymonthday = val.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
    }
  }
  return rule.freq ? rule : null;
}

/** Read every VEVENT out of an .ics document. */
export function parseICS(text) {
  const events = [];
  let current = null;

  for (const raw of unfold(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') {
      current = { exdates: new Set(), title: '', allDay: false };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current && current.start) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const prop = parseLine(line);
    if (!prop) continue;

    switch (prop.name) {
      case 'UID':
        current.uid = prop.value;
        break;
      case 'SUMMARY':
        current.title = unescapeText(prop.value);
        break;
      case 'LOCATION':
        current.location = unescapeText(prop.value);
        break;
      case 'STATUS':
        current.status = prop.value.toUpperCase();
        break;
      case 'DTSTART': {
        const parsed = parseDateTime(prop.value, prop.params);
        if (parsed.date) {
          current.start = parsed.date;
          current.allDay = parsed.allDay;
        }
        break;
      }
      case 'DTEND': {
        const parsed = parseDateTime(prop.value, prop.params);
        if (parsed.date) current.end = parsed.date;
        break;
      }
      case 'RRULE':
        current.rrule = parseRRule(prop.value);
        break;
      case 'EXDATE':
        for (const piece of prop.value.split(',')) {
          const parsed = parseDateTime(piece, prop.params);
          if (parsed.date) current.exdates.add(toISODate(parsed.date));
        }
        break;
      default:
        break;
    }
  }

  return events.filter((e) => e.status !== 'CANCELLED' && e.title);
}

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function occurrenceOf(event, date) {
  return {
    uid: event.uid || `${event.title}@${toISODate(date)}`,
    title: event.title,
    location: event.location || '',
    date: toISODate(date),
    time: event.allDay ? '' : hhmm(event.start),
    allDay: Boolean(event.allDay),
    fromCalendar: true,
  };
}

/**
 * Every date this event falls on between `rangeStart` and `rangeEnd`
 * inclusive. Repeats are walked from DTSTART so COUNT stays honest; the walk
 * is capped so a malformed rule can never spin.
 */
export function expandEvent(event, rangeStart, rangeEnd) {
  if (!event?.start) return [];

  const from = startOfDay(rangeStart);
  const to = startOfDay(rangeEnd);
  const rule = event.rrule;

  if (!rule) {
    const day = startOfDay(event.start);
    return day >= from && day <= to ? [occurrenceOf(event, day)] : [];
  }

  const out = [];
  let emitted = 0;
  let stop = false;

  const consider = (day) => {
    if (stop) return;
    if (day < startOfDay(event.start)) return;
    if (rule.until && day > startOfDay(rule.until)) {
      stop = true;
      return;
    }
    if (rule.count !== null && emitted >= rule.count) {
      stop = true;
      return;
    }
    emitted += 1;
    if (day >= from && day <= to && !event.exdates.has(toISODate(day))) {
      out.push(occurrenceOf(event, day));
    }
  };

  const start = startOfDay(event.start);

  if (rule.freq === 'WEEKLY') {
    const days = rule.byday.length ? rule.byday : [WEEKDAYS[start.getDay()]];
    const offsets = days.map((d) => WEEKDAYS.indexOf(d)).sort((a, b) => a - b);
    const wkstIndex = Math.max(0, WEEKDAYS.indexOf(rule.wkst));
    let cursor = startOfWeek(start, wkstIndex);
    for (let i = 0; i < MAX_ITERATIONS && !stop; i += 1) {
      for (const offset of offsets) {
        const shift = (offset - wkstIndex + 7) % 7;
        consider(addDays(cursor, shift));
      }
      cursor = addDays(cursor, 7 * rule.interval);
      if (cursor > to) break;
    }
  } else if (rule.freq === 'DAILY') {
    let cursor = start;
    for (let i = 0; i < MAX_ITERATIONS && !stop && cursor <= to; i += 1) {
      consider(cursor);
      cursor = addDays(cursor, rule.interval);
    }
  } else if (rule.freq === 'MONTHLY') {
    const monthDays = rule.bymonthday.length ? rule.bymonthday : [start.getDate()];
    for (let i = 0; i < MAX_ITERATIONS && !stop; i += 1) {
      const anchor = new Date(start.getFullYear(), start.getMonth() + i * rule.interval, 1);
      if (anchor > to && i > 0) break;
      for (const dayNum of monthDays) {
        const candidate = new Date(anchor.getFullYear(), anchor.getMonth(), dayNum);
        // Skip a 31st in a 30-day month rather than rolling into the next one.
        if (candidate.getMonth() === anchor.getMonth()) consider(candidate);
      }
    }
  } else if (rule.freq === 'YEARLY') {
    for (let i = 0; i < MAX_ITERATIONS && !stop; i += 1) {
      const candidate = new Date(start.getFullYear() + i * rule.interval, start.getMonth(), start.getDate());
      if (candidate > to) break;
      consider(candidate);
    }
  }

  return out;
}

/** Parse a feed and flatten it to the occurrences inside a date range. */
export function occurrencesInRange(icsText, rangeStart, rangeEnd) {
  return parseICS(icsText)
    .flatMap((event) => expandEvent(event, rangeStart, rangeEnd))
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
}
