// One box instead of six fields.
//
// "soccer thu 4pm lili" is how someone actually types while holding a child.
// A six-field form is how the last version asked, and it is part of why the
// board stopped being fed.
//
// Deliberately no LLM: this runs offline, costs nothing, needs no API key, and
// is completely predictable. What it cannot parse it puts in the title, and
// the phone page shows what it understood before anything is saved.

import { classify, extractPerson } from './classify.js';
import { addDays, fromISODate, startOfDay, toISODate } from './week.js';

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

/** 4pm · 4.30pm · 4:30pm · 16:00 · 8.20am */
const TIME_RE = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/i;

/** 16/10 · 16-10 · 16/10/26 */
const NUMERIC_DATE_RE = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/;

/** 16 oct · oct 16 · 16th october */
const WORD_DATE_RE = new RegExp(
  `\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${Object.keys(MONTHS).join('|')})|(${Object.keys(MONTHS).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b`,
  'i',
);

const RELATIVE_RE = /\b(today|tonight|tomorrow|tmr|tmrw)\b/i;
const NEXT_WEEKDAY_RE = new RegExp(`\\bnext\\s+(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i');
const WEEKDAY_RE = new RegExp(`\\b(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i');

function cut(text, match) {
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** The next occurrence of a weekday, today counting as today. */
function nextWeekday(from, weekday, { skipThisWeek = false } = {}) {
  const base = startOfDay(from);
  let delta = (weekday - base.getDay() + 7) % 7;
  if (skipThisWeek) delta = delta === 0 ? 7 : delta + 7;
  return addDays(base, delta);
}

/** -> { date: Date|null, rest: string } */
export function parseDate(input, today = new Date()) {
  let rest = input;

  const relative = RELATIVE_RE.exec(rest);
  if (relative) {
    const word = relative[1].toLowerCase();
    const date = word === 'today' || word === 'tonight' ? startOfDay(today) : addDays(today, 1);
    return { date, rest: cut(rest, relative) };
  }

  const explicitNext = NEXT_WEEKDAY_RE.exec(rest);
  if (explicitNext) {
    const date = nextWeekday(today, WEEKDAYS[explicitNext[1].toLowerCase()], { skipThisWeek: true });
    return { date, rest: cut(rest, explicitNext) };
  }

  const worded = WORD_DATE_RE.exec(rest);
  if (worded) {
    const day = Number(worded[1] ?? worded[4]);
    const month = MONTHS[(worded[2] ?? worded[3]).toLowerCase()];
    let year = today.getFullYear();
    const candidate = new Date(year, month, day);
    // A date that has already gone is almost always meant for next year.
    if (candidate < startOfDay(today)) year += 1;
    const date = new Date(year, month, day);
    return { date: date.getMonth() === month ? date : null, rest: cut(rest, worded) };
  }

  const numeric = NUMERIC_DATE_RE.exec(rest);
  if (numeric) {
    // Day first: New Zealand writes 16/10 for 16 October.
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    let year = numeric[3] ? Number(numeric[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    const date = new Date(year, month, day);
    const valid = month >= 0 && month <= 11 && date.getMonth() === month && date.getDate() === day;
    return { date: valid ? date : null, rest: cut(rest, numeric) };
  }

  const weekday = WEEKDAY_RE.exec(rest);
  if (weekday) {
    const date = nextWeekday(today, WEEKDAYS[weekday[1].toLowerCase()]);
    return { date, rest: cut(rest, weekday) };
  }

  return { date: null, rest };
}

/** -> { time: 'HH:MM'|'', rest: string } */
export function parseTime(input) {
  const match = TIME_RE.exec(input);
  if (!match) return { time: '', rest: input };

  // 24-hour branch.
  if (match[4] !== undefined) {
    return { time: `${pad(Number(match[4]))}:${match[5]}`, rest: cut(input, match) };
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 12 || minutes > 59) return { time: '', rest: input };

  const meridiem = match[3].toLowerCase();
  if (meridiem === 'pm' && hours !== 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  return { time: `${pad(hours)}:${pad(minutes)}`, rest: cut(input, match) };
}

/**
 * Parse one line into a draft item.
 * Always returns something: whatever could not be understood stays in the
 * title, so nothing is ever silently dropped.
 *
 * -> { title, category, who, date, time, understood: {...} }
 */
export function parseQuickAdd(input, { today = new Date(), names = [], defaultDate } = {}) {
  const raw = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return { title: '', category: 'note', who: '', date: defaultDate || toISODate(today), time: '', understood: {} };
  }

  // Classify from the whole line: the keyword may be a word the parser is
  // about to remove, and the row matters more than the leftover wording.
  const category = classify(raw);

  const timed = parseTime(raw);
  const dated = parseDate(timed.rest, today);
  const { who, title } = extractPerson(dated.rest, names);

  const date = dated.date ? toISODate(dated.date) : defaultDate || toISODate(today);

  return {
    title: title.replace(/^[\s,;:-]+|[\s,;:-]+$/g, '') || raw,
    category,
    who,
    date,
    time: timed.time,
    understood: {
      date: Boolean(dated.date),
      time: Boolean(timed.time),
      who: Boolean(who),
    },
  };
}

/** A short "this is what I understood" line for the phone page. */
export function describeDraft(draft, { dayName } = {}) {
  const bits = [];
  if (draft.date) bits.push(dayName || draft.date);
  if (draft.time) bits.push(draft.time);
  if (draft.who) bits.push(`for ${draft.who}`);
  return bits.join(' · ');
}

export { fromISODate };
