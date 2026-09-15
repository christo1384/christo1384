// Turning a calendar entry into a row on the board.
//
// The family already keeps a shared Google Calendar and keeps it current. The
// board's job is to render that, not to ask anyone to type it a second time —
// re-entering things from texts, email and the calendar is what killed the
// previous version after ten days.
//
// So an event title picks its own row. "Lili Ortho 8.20am" is an appointment
// for Lili at 8:20; nobody has to say so.

import { isCategory } from './categories.js';

/**
 * Keyword -> row. Order does not matter: the longest keyword that matches
 * wins, so "birthday party" beats "party" and "swimming" beats "swim".
 */
export const DEFAULT_RULES = {
  sport: [
    'soccer', 'football', 'netball', 'rugby', 'league', 'cricket', 'hockey', 'basketball',
    'tennis', 'athletics', 'swimming', 'swim', 'training', 'practice', 'trials', 'game',
    'match', 'tournament', 'dance', 'ballet', 'gymnastics', 'karate', 'gym',
  ],
  appointment: [
    'ortho', 'orthodontist', 'dentist', 'dental', 'doctor', 'gp', 'physio', 'specialist',
    'optometrist', 'optician', 'clinic', 'hospital', 'appointment', 'appt', 'check-up',
    'checkup', 'vet', 'haircut', 'barber', 'immunisation', 'vaccination', 'scan',
  ],
  dinner: [
    'dinner', 'tea', 'takeaway', 'takeaways', 'roast', 'bbq', 'barbecue', 'meal',
    'dinner out', 'pizza', 'fish and chips',
  ],
  chore: [
    'bins', 'bin night', 'rubbish', 'recycling', 'washing', 'laundry', 'tidy', 'clean',
    'vacuum', 'mow', 'lawns', 'chore', 'dishes', 'homework',
  ],
  family: [
    'outing', 'family outing', 'trip', 'zoo', 'museum', 'movie', 'movies', 'beach',
    'park', 'picnic', 'playdate', 'play date', 'birthday party', 'party', 'visit',
  ],
  out: [
    'away', 'out of town', 'sleepover', 'camp', 'holiday', 'flight', 'airport',
    'staying at', 'overnight',
  ],
  birthday: ['birthday', 'bday'],
};

export const DEFAULT_FALLBACK = 'appointment';

/** "Dinner: lasagne" — an explicit row prefix always wins over the keywords. */
const PREFIX_ALIASES = {
  birthday: 'birthday',
  birthdays: 'birthday',
  appointment: 'appointment',
  appointments: 'appointment',
  appt: 'appointment',
  dinner: 'dinner',
  tea: 'dinner',
  chore: 'chore',
  chores: 'chore',
  sport: 'sport',
  sports: 'sport',
  family: 'family',
  'family activity': 'family',
  'family outing': 'family',
  outing: 'family',
  activity: 'family',
  note: 'note',
  notes: 'note',
  heads: 'note',
  'heads up': 'note',
  out: 'out',
  'out and about': 'out',
};

const TRAILING_TIME = /[\s(–-]+\d{1,2}([:.]\d{2})?\s*(am|pm)\s*\)?$/i;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive, tolerant of a trailing plural or possessive. */
function mentions(haystack, needle) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}(s|'s|s')?([^a-z0-9]|$)`, 'i').test(haystack);
}

/**
 * Pull a leading "Row:" or "Row -" prefix off a title.
 * -> { category, title } with category null when there is no prefix.
 */
export function stripPrefix(rawTitle) {
  const title = String(rawTitle ?? '').trim();
  const match = /^([a-z][a-z\s/]{1,18}?)\s*[:–-]\s*(.+)$/i.exec(title);
  if (!match) return { category: null, title };

  const key = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
  const category = PREFIX_ALIASES[key];
  if (!category) return { category: null, title };

  return { category, title: match[2].trim() || title };
}

/**
 * Which row an event belongs in.
 * An explicit prefix wins; otherwise the longest matching keyword; otherwise
 * the fallback row.
 */
export function classify(rawTitle, { rules = DEFAULT_RULES, fallback = DEFAULT_FALLBACK } = {}) {
  const { category: prefixed, title } = stripPrefix(rawTitle);
  if (prefixed) return prefixed;
  if (!title) return fallback;

  let best = null;
  for (const [category, keywords] of Object.entries(rules)) {
    if (!isCategory(category)) continue;
    for (const keyword of keywords) {
      if (keyword.length > (best?.length ?? 0) && mentions(title, keyword)) {
        best = { category, length: keyword.length };
      }
    }
  }
  return best ? best.category : fallback;
}

/**
 * Find a family member in a title.
 * -> { who, title }
 *
 * A name at either end is lifted out of the title, because both are ways
 * people write the same thing: "Lili Ortho" from the calendar, "soccer 4pm
 * lili" from the quick-add box. Either way the board shows "Ortho · Lili"
 * rather than repeating the name.
 *
 * A name in the middle is reported but left alone — cutting a word out of the
 * middle of a sentence tends to mangle it ("Twist Lilis plate").
 */
export function extractPerson(rawTitle, names = []) {
  const title = String(rawTitle ?? '').trim();
  if (!title || !names.length) return { who: '', title };

  for (const name of names) {
    const leading = new RegExp(`^${escapeRegExp(name)}(?:'s|s'|s)?\\b[\\s:'-]*`, 'i');
    if (leading.test(title)) {
      const remainder = title.replace(leading, '').trim();
      // "Morgan and Chris eye appointment" is about two people: lifting the
      // first one out would leave "and Chris eye appointment", which reads as
      // a mistake. Record who it starts with and leave the wording alone.
      if (/^(and|&|\+)\b/i.test(remainder)) return { who: name, title };
      // Only lift the name out if something is left to show.
      return { who: name, title: remainder || title };
    }
  }

  for (const name of names) {
    const trailing = new RegExp(`[\\s:,'-]+(?:for\\s+)?${escapeRegExp(name)}(?:'s|s'|s)?$`, 'i');
    if (trailing.test(title)) {
      const remainder = title.replace(trailing, '').trim();
      return { who: name, title: remainder || title };
    }
  }

  for (const name of names) {
    if (mentions(title, name)) return { who: name, title };
  }
  return { who: '', title };
}

/** "Lili Ortho 8.20am" already has a start time; drop the one in the words. */
export function stripRedundantTime(rawTitle, hasTime) {
  const title = String(rawTitle ?? '').trim();
  if (!hasTime) return title;
  const trimmed = title.replace(TRAILING_TIME, '').trim();
  return trimmed || title;
}

/**
 * A calendar occurrence -> a board item, ready to render.
 * Pure: `occurrence` is what ics.js produced.
 */
export function toBoardItem(occurrence, { rules, fallback, names = [], defaultCategory } = {}) {
  const category = defaultCategory && isCategory(defaultCategory)
    ? defaultCategory
    : classify(occurrence.title, { rules, fallback });

  const withoutTime = stripRedundantTime(occurrence.title, Boolean(occurrence.time));
  const { category: prefixed, title: unprefixed } = stripPrefix(withoutTime);
  const { who, title } = extractPerson(prefixed ? unprefixed : withoutTime, names);

  return {
    ...occurrence,
    category,
    who: who || occurrence.who || '',
    title: title || occurrence.title,
  };
}
