# Moving over from the old board

## What changed

| | Before (July 2026) | Now |
| --- | --- | --- |
| Where config lived | `localStorage`, per device, per domain | The deploy, set once in Netlify |
| Setting up a phone | Gear icon, paste Firebase snippet, paste calendar ids, save, reload | Open the page |
| Effect of renaming the site | Every device silently reset to "not set" | Nothing |
| Kitchen screen | `/tv-display.html` | `/` (the old URL redirects) |
| Phone page | `/mobile-update.html` | `/add` (the old URL redirects) |
| Board updates | Polled every 5 minutes | Realtime, within a second |
| Repeating calendar events | — | Expanded from the feed |
| Source code | Only whatever was deployed | This repository |

## The data

The Firestore collection is `items` in the existing `allen-gates-family`
project, so anything already in there is still there.

Each document looks like:

```js
{
  title: "Soccer practice",     // 1–120 characters
  category: "sport",            // birthday | appointment | dinner | chore | sport | family | note | out
  who: "Ruby",                  // optional, up to 40 characters
  date: "2026-07-16",           // YYYY-MM-DD, local
  time: "16:00",                // "" when it has no time
  annual: false,                // true for birthdays: the year is only used for the age
  done: false,
  createdAt, updatedAt          // server timestamps
}
```

If documents from the old version used different field names, they will be
ignored rather than shown, and the security rules will refuse writes that do
not match this shape. Check one document in the Firebase console against the
list above before assuming the history carried over; if the names differ, a
one-off rename in the console is easier than teaching the app two shapes.

## What has not been carried over

**The old `/cal-9f2a71c4` and `/cal-3c8d5417` calendar identifiers.** Whatever
resolved those lives only in the old deployed bundle, and it is not something
this rebuild can guess at. Calendars are now plain Google Calendar "secret
address in iCal format" URLs, set once in `CALENDAR_ICS_URLS` — see
`docs/DEPLOY.md` §4.

## Worth doing while you are in there

The July 2026 setup email sent the Firebase keys in plain text to a Gmail
address, and said those keys let any device read and write the family list.
That is no longer true once `firebase/firestore.rules` is deployed and
Anonymous sign-in is on — unauthenticated requests are refused, and writes have
to be the right shape.

If you want to be thorough, rotating the web API key in the Firebase console
after this is live costs one environment variable change and a redeploy, and
retires the key that went out by email.

## Switching over

1. Deploy this repository following `docs/DEPLOY.md`.
2. Check the board on the kitchen screen shows the current week.
3. Send everyone the new link. There are no setup steps to include this time —
   open it, and Add to Home Screen if they want it to look like an app.
4. Old bookmarks keep working: `/tv-display.html` redirects to the board and
   `/mobile-update.html` to `/add`, so the kitchen screen and any home-screen
   icons survive the switch untouched.
