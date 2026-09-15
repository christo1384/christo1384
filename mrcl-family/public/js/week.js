// Pure week/date helpers. No DOM, no Firebase — so the Node tests can import
// this file directly, exactly as the browser does.
//
// Everything works in LOCAL time. Dates are stored as 'YYYY-MM-DD' strings and
// parsed back with an explicit year/month/day constructor, never `new
// Date(string)`, which would treat them as UTC and shift the whole board a day
// in New Zealand.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Local midnight for a Date, stripped of any time component. */
export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Date -> 'YYYY-MM-DD' in local time. */
export function toISODate(d) {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 'YYYY-MM-DD' -> Date at local midnight, or null if it isn't a valid date. */
export function fromISODate(iso) {
  const m = ISO_RE.exec(String(iso || ''));
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  // Rejects things like 2026-02-31, which JS would roll forward to March.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function addDays(d, n) {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addWeeks(d, n) {
  return addDays(d, n * 7);
}

/**
 * The first day of the week containing `date`.
 * `weekStartsOn` is 0 for Sunday, 1 for Monday.
 */
export function startOfWeek(date, weekStartsOn = 1) {
  const d = startOfDay(date);
  const shift = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(d, -shift);
}

/**
 * The seven day descriptors the board renders as columns.
 * `today` is injectable so tests don't depend on the clock.
 */
export function buildWeek(anchor, { weekStartsOn = 1, today = new Date() } = {}) {
  const first = startOfWeek(anchor, weekStartsOn);
  const todayISO = toISODate(today);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(first, i);
    const iso = toISODate(date);
    days.push({
      date,
      iso,
      index: i,
      name: DAY_NAMES[date.getDay()],
      short: DAY_NAMES[date.getDay()].slice(0, 3),
      dayNum: date.getDate(),
      month: MONTH_NAMES[date.getMonth()],
      monthIndex: date.getMonth(),
      year: date.getFullYear(),
      isToday: iso === todayISO,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
    });
  }
  return days;
}

/** '2026-10-12' — identifies a week by its first day, for URLs. */
export function weekId(days) {
  return days[0].iso;
}

/** "12 – 18 Oct 2026", collapsing the repeated month and year. */
export function weekLabel(days) {
  const a = days[0];
  const b = days[days.length - 1];
  if (a.year !== b.year) return `${a.dayNum} ${a.month} ${a.year} – ${b.dayNum} ${b.month} ${b.year}`;
  if (a.monthIndex !== b.monthIndex) return `${a.dayNum} ${a.month} – ${b.dayNum} ${b.month} ${b.year}`;
  return `${a.dayNum} – ${b.dayNum} ${b.month} ${b.year}`;
}

/** '16:30' -> '4:30pm'. Returns '' for anything unparseable. */
export function formatTime(value) {
  const m = TIME_RE.exec(String(value || '').trim());
  if (!m) return '';
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return '';
  const suffix = hours < 12 ? 'am' : 'pm';
  hours %= 12;
  if (hours === 0) hours = 12;
  return minutes === 0 ? `${hours}${suffix}` : `${hours}:${String(minutes).padStart(2, '0')}${suffix}`;
}

/** Minutes since midnight, or null when the item has no time set. */
export function timeValue(item) {
  const m = TIME_RE.exec(String(item?.time || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Board order within a cell: timed items first in clock order, then untimed
 * ones alphabetically. Done items sink to the bottom so the live stuff reads
 * first from across the kitchen.
 */
export function compareItems(a, b) {
  if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
  const ta = timeValue(a);
  const tb = timeValue(b);
  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  if (ta !== null && tb === null) return -1;
  if (ta === null && tb !== null) return 1;
  return String(a.title || '').localeCompare(String(b.title || ''));
}

/**
 * Place an annual item (a birthday) onto whichever day of this week it falls
 * on, ignoring the year it was stored with. Returns null if it isn't in the
 * week. 29 February lands on 28 February in non-leap years so it never
 * silently disappears.
 */
export function placeAnnual(item, days) {
  const stored = fromISODate(item.date);
  if (!stored) return null;
  const month = stored.getMonth();
  const day = stored.getDate();

  let match = days.find((d) => d.monthIndex === month && d.dayNum === day);
  if (!match && month === 1 && day === 29) {
    match = days.find((d) => d.monthIndex === 1 && d.dayNum === 28 && !isLeapYear(d.year));
  }
  if (!match) return null;

  const years = match.year - stored.getFullYear();
  return {
    ...item,
    date: match.iso,
    annualYears: years > 0 && years < 120 ? years : null,
  };
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Resolve a raw item list against a week: annual items get moved onto this
 * year's date, dated items are kept only if they land inside the week.
 */
export function itemsForWeek(items, days) {
  const inWeek = new Set(days.map((d) => d.iso));
  const out = [];
  for (const item of items || []) {
    if (item.annual) {
      const placed = placeAnnual(item, days);
      if (placed) out.push(placed);
    } else if (inWeek.has(item.date)) {
      out.push(item);
    }
  }
  return out;
}

/**
 * items -> { [categoryId]: { [dayISO]: item[] } }, each cell sorted for the
 * board. Cells with nothing in them are simply absent.
 */
export function groupByCategoryAndDay(items) {
  const grouped = {};
  for (const item of items) {
    const cat = (grouped[item.category] ||= {});
    (cat[item.date] ||= []).push(item);
  }
  for (const cat of Object.values(grouped)) {
    for (const cell of Object.values(cat)) cell.sort(compareItems);
  }
  return grouped;
}

/** Every item in a category across the whole week, in day then board order. */
export function bandItems(items, categoryId, days) {
  const order = new Map(days.map((d, i) => [d.iso, i]));
  return items
    .filter((i) => i.category === categoryId)
    .sort((a, b) => {
      const da = order.get(a.date) ?? 0;
      const db = order.get(b.date) ?? 0;
      return da === db ? compareItems(a, b) : da - db;
    });
}
