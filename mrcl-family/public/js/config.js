// Configuration is baked into the deploy, never entered on the device.
//
// This is the whole point of the rebuild. The previous version kept its keys
// and calendar ids in each browser's localStorage, which is scoped to the
// exact domain — so renaming the Netlify site silently wiped every TV and
// phone and each one had to be re-onboarded by hand.
//
// Now `npm run build` writes public/config.generated.js from the Netlify
// environment variables, and every device that loads the page is already
// set up. Nothing to paste, nothing to lose.

const DEFAULTS = {
  boardTitle: 'The MRCL family Week',
  familyName: 'MRCL',

  // 1 = weeks run Monday to Sunday, 0 = Sunday to Saturday.
  weekStartsOn: 1,

  // The family's own calendars, read-only, merged onto the board. Each entry
  // is either an ICS URL or { url, category, label }: with no category, each
  // event picks its own row from its title (see classify.js).
  //
  // This is where most of the board's content comes from. The family already
  // keeps a shared Google Calendar current; asking anyone to retype it into
  // the board is what killed the previous version.
  calendars: [],

  // Used to pull the person out of an entry, so "Lili Ortho" shows as
  // "Ortho · Lili" instead of repeating itself.
  familyNames: [],

  weather: {
    enabled: true,
    latitude: -36.9442,
    longitude: 174.8436,
    label: 'Ōtāhuhu',
    timezone: 'Pacific/Auckland',
  },

  tv: {
    // Belt and braces behind the realtime listener.
    refreshMinutes: 15,
    // Reload in the small hours so a new deploy is picked up overnight.
    reloadHour: 3,
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** One level of nesting is all this config has, so a shallow-deep merge does. */
function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? { ...base[key], ...value } : value;
  }
  return out;
}

const injected = (typeof window !== 'undefined' && window.__MRCL__) || {};

export const CONFIG = merge(DEFAULTS, injected);

/**
 * There is nothing left that has to be configured before the board works: the
 * store lives on this same site, and a board with no calendars is simply an
 * empty board you can still add to. This exists so the pages can say something
 * useful when a deploy has no calendars at all.
 */
export function hasCalendars(config = CONFIG) {
  return Array.isArray(config.calendars) && config.calendars.length > 0;
}

export { DEFAULTS, merge };
