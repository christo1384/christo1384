// The shape of one thing on the board, and the rules for what may be written.
//
// Both sides use this: the phone page for an instant message, and
// src/board-api.mjs before anything is written. Keeping one definition means
// the two can never drift apart.

import { CATEGORY_IDS, isCategory } from './categories.js';
import { fromISODate } from './week.js';

export const MAX_TITLE = 120;
export const MAX_WHO = 40;
export const DEFAULT_CATEGORY = 'appointment';

/**
 * How an item repeats.
 * - 'none'   a one-off, filed against the week it falls in
 * - 'weekly' every week on the same weekday: bins night, swimming
 * - 'annual' every year on the same date: birthdays
 *
 * Weekly matters because the chore row is otherwise only usable for one-offs,
 * and putting "bins out" in the shared Google Calendar every week just clutters
 * the calendar.
 */
export const REPEATS = ['none', 'weekly', 'annual'];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function text(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Coerce anything form-shaped into the canonical stored shape. */
export function normaliseItem(input = {}) {
  const time = String(input.time ?? '').trim();
  return {
    title: text(input.title, MAX_TITLE),
    category: isCategory(input.category) ? input.category : DEFAULT_CATEGORY,
    who: text(input.who, MAX_WHO),
    date: String(input.date ?? '').trim(),
    time: TIME_RE.test(time) ? time : '',
    repeat: normaliseRepeat(input),
    done: Boolean(input.done),
  };
}

/** Accepts the older `annual: true` shape as well as an explicit `repeat`. */
export function normaliseRepeat(input = {}) {
  if (REPEATS.includes(input.repeat)) return input.repeat;
  return input.annual ? 'annual' : 'none';
}

/** True for anything that is not filed against one particular week. */
export function isRepeating(item) {
  return normaliseRepeat(item) !== 'none';
}

/**
 * -> { ok, value, errors: [{ field, message }] }
 * `value` is always the normalised item, so a caller can show the cleaned-up
 * form back to the user even when it failed.
 */
export function validateItem(input = {}) {
  const value = normaliseItem(input);
  const errors = [];

  if (!value.title) {
    errors.push({ field: 'title', message: 'Give it a name.' });
  }
  if (!isCategory(input.category)) {
    errors.push({ field: 'category', message: `Pick one of: ${CATEGORY_IDS.join(', ')}.` });
  }
  if (!fromISODate(value.date)) {
    errors.push({ field: 'date', message: 'Pick a real date.' });
  }
  if (String(input.time ?? '').trim() && !value.time) {
    errors.push({ field: 'time', message: 'Time needs to look like 16:30, or be left empty.' });
  }

  return { ok: errors.length === 0, value, errors };
}

/** What the board shows on the right-hand side of an item, if anything. */
export function itemSubtitle(item) {
  const bits = [];
  if (item.who) bits.push(item.who);
  if (item.annualYears) bits.push(`turns ${item.annualYears}`);
  if (item.location) bits.push(item.location);
  return bits.join(' · ');
}

/* --------------------------------------------------------- shopping list */

export const MAX_SHOPPING_TITLE = 80;

/**
 * The shopping list is not part of the week: it is a rolling list that is
 * added to from the kitchen and ticked off in the supermarket.
 */
export function normaliseShoppingItem(input = {}) {
  return {
    title: text(input.title, MAX_SHOPPING_TITLE),
    who: text(input.who, MAX_WHO),
    done: Boolean(input.done),
  };
}

export function validateShoppingItem(input = {}) {
  const value = normaliseShoppingItem(input);
  const errors = value.title ? [] : [{ field: 'title', message: 'What do we need?' }];
  return { ok: errors.length === 0, value, errors };
}
