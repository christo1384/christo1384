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

// Which calendars a deploy has is not build-time configuration any more: the
// addresses are secrets that stay on the server, and the pages ask
// /api/calendars for the list at runtime. See calendar.js.

export { DEFAULTS, merge };
