# Deploying the family week

The whole thing is **one Node service**. It serves the pages, the API and the
calendar proxy from a single process, so there is one console, one deploy and
one set of settings. No Firebase, no second account, no auth provider.

It currently runs on Render, but nothing about it is Render-specific: anything
that can run `node server.mjs` will do.

---

## What is already set up

| | |
| --- | --- |
| Service | `mrcl-family` (Render, Singapore, free plan) |
| URL | https://mrcl-family.onrender.com |
| Store | `mrcl-family-store` (Render Key Value, free plan) |
| Deploys from | `christo1384/christo1384`, branch `claude/mrcl-app-build-family-dashboard-73uh72` |
| Auto-deploy | flag is on, but see below |

Singapore is the closest Render region to New Zealand.

> **Pushes do not redeploy yet.** The service was created through Render's API
> with a repository URL, which does not install the GitHub webhook, so nothing
> notices a new commit. Two ways to fix it, either is a one-off:
>
> - In the Render dashboard, **Settings → Build & Deploy → Link repository**,
>   and pick the repo through the GitHub connection. Auto-deploy then works.
> - Or leave it and redeploy on demand from the dashboard's **Manual Deploy**
>   button.
>
> Until then a push only changes the code that the *next* deploy will use.

---

## Settings

All of these are environment variables on the service.

| Variable | Required | What it is |
| --- | --- | --- |
| `ACCESS_KEY` | **yes** | The shared key that unlocks the board. See below. |
| `REDIS_URL` | yes | The Key Value connection string |
| `CALENDAR_ICS_URLS` | strongly recommended | Feed addresses, comma or newline separated |
| `FAMILY_NAMES` | recommended | e.g. `Lili,Chris` — used to pull the person out of an entry |
| `ALLOWED_EMAILS` | no | Recorded for reference; not enforced (see below) |
| `SNAPSHOT_PATH` | no | Local snapshot file. Empty string turns it off. |
| `BOARD_TITLE` | no | Defaults to `The MRCL family Week` |
| `WEEK_STARTS_ON` | no | `1` for Monday (default), `0` for Sunday |
| `WEATHER_LATITUDE` / `WEATHER_LONGITUDE` | no | Defaults to Ōtāhuhu |
| `WEATHER_ENABLED` | no | `false` hides the weather strip |

`FAMILY_NAMES` and the weather settings are read at **build** time (they end up
in `public/config.generated.js`); everything else is read at **run** time.
Changing a build-time one needs a redeploy.

---

## Who can get in

Opening `https://mrcl-family.onrender.com/?k=<ACCESS_KEY>` once on a device
sets a cookie that lasts ten years. After that the plain URL works and the key
is never needed again on that device. Without the cookie, every page and every
API call returns 401.

The cookie is an HMAC of the key, not the key itself, so a stolen cookie cannot
be turned back into the link.

**Why a shared key and not Google sign-in.** The kitchen screen has no
keyboard. Anything that needs re-authenticating every few weeks does not
survive being mounted on a wall — and the last version died of exactly this
kind of friction. A link that stays signed in is the only thing that actually
works for a TV.

`ALLOWED_EMAILS` records that this board is for `crsroe@gmail.com` and
`allengates1302@gmail.com`. It is **not enforced**: enforcing it needs a Google
OAuth client id, which can only be created by hand in the Google Cloud console.
If you want that on the phones (leaving the TV on the key), it is roughly an
hour of work once the client id exists — say the word.

To change the key: set a new `ACCESS_KEY`, redeploy, and send everyone the new
link. Every existing cookie stops working, which is also how you lock out a
lost phone.

---

## Connecting the family calendar

This is the step that decides whether the board survives. A board you hand-feed
from texts, email and your calendar is a second place to type everything, and
it will be abandoned in a fortnight. A board that renders the calendar you
already keep costs nothing to maintain.

### Get the feed address

In Google Calendar, for each calendar: **Settings → (the calendar) → Integrate
calendar → Secret address in iCal format.** Copy that URL.

| Calendar | What it gives the board |
| --- | --- |
| **MRCL Family Calendar** | Nearly everything — this is the one that matters |
| **Holidays in New Zealand** | Public holidays (already connected; its address is public) |
| Chris 7 Crawford Ave (Google Classroom) | Term dates, teacher-only days |

Add them to `CALENDAR_ICS_URLS`, comma separated, and redeploy.

> A secret iCal address grants read access to that calendar to anyone holding
> it, so treat these like passwords. They stay in the service's environment and
> are **never** sent to the browser: the pages ask `/api/calendars` for a list
> of feeds with no addresses in them, then fetch `/api/calendar?feed=0`. The
> proxy also refuses anything that is not `https`, so it cannot be aimed at
> Render's own network.

### How entries find their row

Nobody labels anything. An entry picks its row from its own title:

| Calendar entry | Row | Shows as |
| --- | --- | --- |
| `Lili Ortho 8.20am` | Appointments | Ortho · Lili |
| `Soccer practice` | Sports | Soccer practice |
| `Family outing: Auckland Zoo` | Family activity | Auckland Zoo |
| `Bins out` | Chore | Bins out |

To force a row, prefix the entry: `Dinner: lasagne`, `Note: soccer cancelled`.
To pin a whole feed to one row, use the JSON form of `CALENDAR_ICS_URLS`:

```json
[{"url":"https://calendar.google.com/…/basic.ics","category":"sport","label":"Ruby"}]
```

The keyword lists are in `public/js/classify.js` and are easy to extend.

Repeating events are expanded (daily, weekly with `BYDAY`, monthly, yearly,
with `INTERVAL`, `COUNT`, `UNTIL` and `EXDATE`).

Calendar entries are read-only on the board. They can be **ticked off** — which
is recorded against the week, not the calendar — but not edited or deleted
there. The calendar stays the single source of truth.

---

## What the board holds itself

Three things do not belong in a calendar and live on the board instead:

**One-offs** — "home late", what's for dinner. Filed against the week.

**Weekly repeats** — bins night, swimming. Set the repeat to *Every week* and it
lands on that weekday from then on, without a recurring calendar event
appearing in everyone's own week view. It never backfills the weeks before it
was created.

**The shopping list** — a rolling list, not part of any week. Added to from the
kitchen, ticked off in the supermarket; tapping the row is the tick. "Clear
what is in the trolley" removes the ticked ones and keeps the rest. The kitchen
screen shows only a count, because a screen on a wall cannot be added to.

---

## The screens

**The kitchen screen:** open the `?k=` link once, then leave `/` on screen. It
shows the current week, rolls over at midnight, and reloads at 3am to pick up a
new deploy.

**Each phone:** open the `?k=` link, go to `/add`, then Share → *Add to Home
Screen* (iPhone) or ⋮ → *Add to Home screen* (Android). That is the whole setup.

The previous version's URLs redirect, so nothing has to be re-bookmarked:
`/tv-display.html` → `/` and `/mobile-update.html` → `/add`.

---

## Things to know about the free plan

**The service sleeps after 15 minutes with no traffic** and takes roughly 50
seconds to wake. The kitchen screen polls every 15 seconds, so while it is on
the service stays awake; the first phone to open it in the morning may wait.
The Starter plan removes this.

**Key Value runs with persistence off on the free plan.** If it restarts, what
it holds is lost. The board defends against this: `src/store.mjs` keeps a local
snapshot as well, so Key Value coming back empty is refilled from the service,
and the service restarting is refilled from Key Value. Both would have to go at
once to lose a week — and even then, everything from the calendar comes back
straight away, because that is fetched fresh every time. Only notes, dinners
and ticks are at risk.

---

## Running it yourself

```sh
npm install
npm run dev        # http://localhost:8080
```

With no `REDIS_URL` the store is in-memory and no cloud resources are touched.
With no `ACCESS_KEY` the board is open, which is what local work wants.

```sh
npm test                              # 130 logic tests
npm install --no-save playwright      # only for the browser suite
npm run test:browser                  # 66 checks in Chromium
```

---

## Troubleshooting

| What you see | What it means |
| --- | --- |
| "This board is for the family" | No cookie on this device. Open the `?k=` link. |
| First load takes ~50s | The free service had gone to sleep. |
| "No calendars connected yet" | `CALENDAR_ICS_URLS` is not set, or the deploy predates it. |
| Board loads but is empty | Nothing on this week. Check the calendar, or add something from `/add`. |
| Calendar entries missing | The address must be exactly right, and `https`. Check `/healthz` for the feed count. |
| An entry is in the wrong row | Prefix it (`Dinner: …`) or add the keyword to `public/js/classify.js`. |
| Notes gone after a while | Key Value restarted with persistence off. See above. |

`GET /healthz` reports the store backend and how many feeds are configured,
without needing the key.
