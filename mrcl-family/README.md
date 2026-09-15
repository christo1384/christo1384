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

Two things killed the first version, and only one of them was a bug.

**It lost its own configuration.** The Firebase keys and calendar ids lived in
each browser's `localStorage`, which is scoped to the exact domain — so
renaming the Netlify site wiped every device at once, and each TV and phone had
to be re-onboarded by hand through a gear icon.

**It asked to be hand-fed.** Everything on the board had to be retyped from
texts, email, the calendar and a to-do list. A board that duplicates what you
already keep somewhere else is a second place to type everything, and nobody
maintains that. It lasted ten days.

So this version fixes both:

**Configuration lives in the deploy, not on the device.** `npm run build`
writes `public/config.generated.js` from the Netlify environment variables, and
any screen that loads the page is already set up. Nothing to paste, nothing to
lose if the domain changes again.

**The board reads the family's calendar instead of competing with it.** The
shared Google Calendar is already kept current; the board renders it. An entry
picks its own row from its title — "Lili Ortho 8.20am" becomes an appointment
for Lili at 8:20 with nobody configuring anything (`public/js/classify.js`).
Calendar rows can be ticked off on the board without the calendar ever being
written to.

What is left over — "home late", what's for dinner — goes in through **one
box**: `soccer thu 4pm lili`. The six-field form is still there behind "More
detail", but it is no longer the front door (`public/js/quickadd.js`).

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
| `public/js/classify.js` | Turns a calendar entry into a board row and a person. |
| `public/js/quickadd.js` | Turns one typed line into an item. |
| `public/js/item.js` | The shape of an item, and what may be written. |
| `public/js/config.js` | Defaults, merged with what the build injected. |
| `netlify/functions/board.mjs` | The board's own store, on Netlify Blobs. |
| `netlify/functions/calendar.mjs` | Fetches .ics feeds the browser cannot reach. |
| `tools/build-config.mjs` | Turns environment variables into the deploy's config. |
| `tools/dev-board.mjs` | In-memory stand-in for the store, for local work. |
| `tools/serve.mjs` | Local preview server, no install required. |
| `test/` | Node tests for the logic, a browser suite for the pages. |

One runtime dependency, `@netlify/blobs`, used only by the functions. There is
no Firebase, no second console, no auth provider and no SDK loaded from a CDN.

## Running it locally

```sh
npm run build     # writes public/config.generated.js
npm run dev       # http://localhost:8080
```

Nothing has to be configured for it to run: the store lives on the same site,
and a board with no calendars is simply an empty board you can still add to.
`npm run dev` uses an in-memory store, so no cloud resources are touched.

To try it against real calendars locally, create a gitignored
`config.local.json`:

```json
{
  "calendars": [
    "https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
  ],
  "familyNames": ["Lili", "Ruby", "Max"]
}
```

## Tests

```sh
npm test                              # 102 logic tests
npm install --no-save playwright      # only needed for the browser suite
npm run test:browser                  # 66 checks across both pages in Chromium
```

The browser suite stubs the board API and the calendar feed, freezes the clock,
and drives the real render path: a calendar entry classifying itself into the
right row with the person lifted out of the title, one typed line becoming a
full item, a ticked-off row greying out instead of vanishing, a calendar row
ticking off without being editable, the board filling a 1080p screen without
scrolling, the phone page not scrolling sideways, and the board still showing
its calendar when its own store is unreachable.

## Deploying

See [`docs/DEPLOY.md`](docs/DEPLOY.md). Short version: link the repo to
Netlify, set `CALENDAR_ICS_URLS` and `FAMILY_NAMES`, and open the site on the
kitchen screen. One console, no Firebase.

Two things catch people out, both covered there: Netlify needs a **base
directory** of `mrcl-family` while this lives inside the profile repository,
and Netlify's **secrets scanning** fails the build unless
`SECRETS_SCAN_OMIT_KEYS` names `CALENDAR_ICS_URLS` — the build writes it into
the deployed JavaScript on purpose.

## Two things worth knowing

**The calendar feed URLs are secrets.** A Google Calendar "secret address in
iCal format" grants read access to that calendar to anyone holding it, which is
why they live in Netlify's environment and not in this public repository.
`netlify/functions/calendar.mjs` only ever fetches URLs on the deploy's own
allowlist, so the endpoint cannot be pointed anywhere else.

**There is no Content-Security-Policy header yet.** One is drafted in
`docs/DEPLOY.md` under "Optional hardening", but it is left off by default: a
CSP that is subtly wrong fails silently in the browser, and that is exactly the
kind of breakage that stopped the last version being used. Add it when you can
watch the board afterwards and confirm it still loads.
