// The rows of the family week, in the order they appear on the board.
//
// `band: true` rows span the whole week as a single strip (the way BIRTHDAYS
// and OUT AND ABOUT are drawn across the top and bottom of the original
// wireframe). Everything else is a row of seven per-day cells.

export const CATEGORIES = [
  {
    id: 'birthday',
    label: 'Birthdays',
    short: 'Birthday',
    band: 'top',
    accent: '#5bd98a',
    annualCapable: true,
  },
  {
    id: 'appointment',
    label: 'Appointments',
    short: 'Appointment',
    band: null,
    accent: '#ff9f57',
  },
  {
    id: 'dinner',
    label: 'Dinner',
    short: 'Dinner',
    band: null,
    accent: '#ffd166',
  },
  {
    id: 'chore',
    label: 'Chore',
    short: 'Chore',
    band: null,
    accent: '#f78da7',
  },
  {
    id: 'sport',
    label: 'Sports',
    short: 'Sport',
    band: null,
    accent: '#7cc4ff',
  },
  {
    id: 'family',
    label: 'Family activity',
    short: 'Family activity',
    band: null,
    accent: '#c792ea',
  },
  {
    id: 'note',
    label: 'Other / heads up',
    short: 'Note / heads-up',
    band: null,
    accent: '#a7b0bd',
  },
  {
    id: 'out',
    label: 'Out and about',
    short: 'Out and about',
    band: 'bottom',
    accent: '#6fd6d8',
  },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** The category record for an id, falling back to "Other / heads up". */
export function category(id) {
  return BY_ID.get(id) || BY_ID.get('note');
}

export function isCategory(id) {
  return BY_ID.has(id);
}

/** Rows drawn as per-day grid rows, top to bottom. */
export const GRID_CATEGORIES = CATEGORIES.filter((c) => !c.band);

/** Rows drawn as full-width strips, keyed by where they sit. */
export const BAND_CATEGORIES = CATEGORIES.filter((c) => c.band);
