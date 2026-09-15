// Configuration is baked into the deploy, never entered on the device.
//
// This is the whole point of the rebuild. The previous version kept the
// Firebase keys and calendar ids in each browser's localStorage, which is
// scoped to the exact domain — so renaming the Netlify site silently wiped
// every TV and phone and each one had to be re-onboarded by hand.
//
// Now `npm run build` writes public/config.generated.js from the Netlify
// environment variables, and every device that loads the page is already
// set up. Nothing to paste, nothing to lose.

const DEFAULTS = {
  boardTitle: 'The MRCL family Week',
  familyName: 'MRCL',

  // 1 = weeks run Monday to Sunday, 0 = Sunday to Saturday.
  weekStartsOn: 1,

  firebase: null,
  collection: 'items',

  // Read-only ICS feeds merged onto the board. See docs/DEPLOY.md.
  calendars: [],

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

const REQUIRED_FIREBASE_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

/** True once the deploy carries a usable Firebase project. */
export function isConfigured(config = CONFIG) {
  const fb = config.firebase;
  return isPlainObject(fb) && REQUIRED_FIREBASE_KEYS.every((key) => typeof fb[key] === 'string' && fb[key].length > 0);
}

/** Which required keys are missing, for the setup message. */
export function missingFirebaseKeys(config = CONFIG) {
  const fb = isPlainObject(config.firebase) ? config.firebase : {};
  return REQUIRED_FIREBASE_KEYS.filter((key) => !fb[key]);
}

export { DEFAULTS, merge };
