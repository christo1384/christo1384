# The MRCL family Week

The family week on the kitchen screen, and a phone page for adding to it.

A rebuild of the family dashboard that ran at `mrcl-family.netlify.app` from
July 2026. The layout follows the hand-drawn wireframe: a birthdays strip, a
grid of category rows against day columns, then weather and out-and-about along
the bottom.

```
The MRCL family Week                              13 – 19 Jul 2026     4:30pm
┌────────────────────────────────────────────────────────────────────────────┐
│ BIRTHDAYS   Thu · Ruby turns 9                                             │
└────────────────────────────────────────────────────────────────────────────┘
                MON    TUE    WED    THU    FRI    SAT    SUN
 APPOINTMENTS                 9:15am
 DINNER                              Lasagne
 CHORE                 Bins out
 SPORTS                              4pm Soccer
 FAMILY ACTIVITY
 OTHER / HEADS UP
┌────────────────────────────────────────────────────────────────────────────┐
│ WEATHER      ☁️ 14° 8°   🌧️ 16° 10°  ...                                    │
│ OUT AND ABOUT   Sat · Nana visiting                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

## Why it was rebuilt

The previous version kept its Firebase keys and calendar ids in each browser's
`localStorage`. That storage is scoped to the exact domain, so renaming the
Netlify site from `preeminent-puppy-76d698` to `mrcl-family` silently wiped
every device at once. Each TV and phone then had to be re-onboarded by hand —
open a gear icon, paste a config snippet, paste two calendar lines, save and
reload. The rollout did not survive that, and the board stopped being used.

**Configuration now lives in the deploy, not on the device.** `npm run build`
writes `public/config.generated.js` from the Netlify environment variables, and
any screen that loads the page is already set up. There is no settings screen,
nothing to paste, and nothing to lose if the domain changes again.

## What it does

**The board** (`/`) — for the kitchen screen. Always the current week, rebuilds
itself when the date rolls over, and updates within a second of someone tapping
Done on a phone. No controls: a screen on a wall has nobody to press them.

**The phone page** (`/add`) — add something, tick it off, edit it, delete it,
and look at next week. Add it to the home screen and it opens like an app.

The previous version's URLs still work: `/tv-display.html` redirects to the
board and `/mobile-update.html` to `/add`, so existing bookmarks and
home-screen icons survive the switch.

Ticking something off greys it out rather than removing it, so you can still
see what has been handled — the same behaviour the old board had.

Birthdays can be marked *every year*: the stored year is then only used to work
out the age ("Ruby turns 9"), and the entry appears on the right day annually.

## Layout of the repo

| Path | What it is |
| --- | --- |
| `public/` | The whole site. Plain ES modules, no bundler, no framework. |
| `public/js/week.js` | Week and date logic. Pure, and the most tested part. |
| `public/js/ics.js` | iCalendar reader, including repeating events. |
| `public/js/item.js` | The shape of an item, and what may be written. |
| `public/js/config.js` | Defaults, merged with what the build injected. |
| `netlify/functions/calendar.mjs` | Fetches .ics feeds the browser cannot reach. |
| `firebase/firestore.rules` | The rules that actually enforce access. |
| `tools/build-config.mjs` | Turns environment variables into the deploy's config. |
| `tools/serve.mjs` | Local preview server, no install required. |
| `test/` | Node tests for the logic, a browser suite for the pages. |

There are **no runtime dependencies**. Netlify installs nothing to build this.

## Running it locally

```sh
npm run build     # writes public/config.generated.js
npm run dev       # http://localhost:8080
```

Without a Firebase configuration the site still builds and loads; it shows its
setup message instead of the board. To point it at a real project locally,
create a gitignored `config.local.json`:

```json
{
  "firebase": {
    "apiKey": "…",
    "authDomain": "…",
    "projectId": "…",
    "storageBucket": "…",
    "messagingSenderId": "…",
    "appId": "…"
  },
  "calendars": []
}
```

## Tests

```sh
npm test                              # 68 logic tests, no dependencies
npm install --no-save playwright      # only needed for the browser suite
npm run test:browser                  # drives both pages in Chromium
```

The browser suite stubs Firebase and freezes the clock, then checks the real
render path: that items land in the right cell, that a ticked-off item greys
out instead of vanishing, that the board fills the screen without scrolling,
that the phone page does not scroll sideways, and that the board still renders
a useful error if Firebase cannot be reached at all.

## Deploying

See [`docs/DEPLOY.md`](docs/DEPLOY.md). Short version: set `FIREBASE_CONFIG` in
the Netlify environment variables, deploy the Firestore rules, turn on
Anonymous sign-in, and open the site on the kitchen screen.

## Two things worth knowing

**The Firebase web keys are not secrets**, but they are not published here
either. They identify the project; what protects the data is
`firebase/firestore.rules` plus Anonymous sign-in. Keeping the keys in Netlify's
environment rather than in this public repository means the family's board is
not something a search engine can index its way into.

**There is no Content-Security-Policy header yet.** One is drafted in
`docs/DEPLOY.md` under "Optional hardening", but it is left off by default: a
CSP that is subtly wrong fails silently in the browser, and that is exactly the
kind of breakage that stopped the last version being used. Add it when you can
watch the board afterwards and confirm it still loads.
