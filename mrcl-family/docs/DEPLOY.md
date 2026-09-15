# Deploying the family week

Everything here is done **once**, by one person, in **one console**. Nobody in
the house sets up anything on their own phone — that was the first flaw in the
previous version.

There is no Firebase, no second account, no auth provider and no rules file.
The board's store is Netlify Blobs, which is part of the Netlify site itself.

---

## 1. Netlify

### 1a. Connect the repository

Netlify reads its settings from `netlify.toml`:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |

**Base directory matters.** While this project lives inside the
`christo1384/christo1384` profile repository, `netlify.toml` is not at the
repository root, so Netlify will not find it on its own. Set:

| Setting | Value |
| --- | --- |
| Base directory | `mrcl-family` |

If the project is ever split into its own repository, clear that setting.

> The original `mrcl-family` site is a **drag-and-drop deploy** (Netlify records
> it as `deploy_source: drop`), so it has no repository attached and no build
> step. Connecting it to git is a one-off: **Site configuration → Build &
> deploy → Link repository**. Linking is also the only way to deploy without
> direct network access to `api.netlify.com`.

### 1b. Deploy

Trigger a deploy. Netlify Blobs needs no setup at all — the store exists as
soon as the site does. The build log should say:

```
[build-config] wrote public/config.generated.js (1 calendar feed(s), 3 family name(s))
```

**At this point the board already works.** It will be empty, because nothing is
feeding it yet. That is step 2.

---

## 2. Connect the family calendar

This is the step that decides whether the board survives. A board you have to
hand-feed from texts, email and your calendar is a second place to type
everything, and it will be abandoned in a fortnight. A board that renders the
calendar you already keep costs nothing to maintain.

### 2a. Get the feed address

In Google Calendar, for each calendar you want on the board:

**Settings → (the calendar) → Integrate calendar → Secret address in iCal
format.** Copy that URL.

Calendars worth connecting:

| Calendar | What it gives the board |
| --- | --- |
| **MRCL Family Calendar** | Nearly everything — this is the one that matters |
| **Holidays in New Zealand** | Public holidays |
| The school's Google Classroom calendar | Term dates, teacher-only days |

### 2b. Set it in Netlify

**Site configuration → Environment variables.**

| Variable | Required | What it is |
| --- | --- | --- |
| `CALENDAR_ICS_URLS` | strongly recommended | Feed addresses, comma or newline separated |
| `FAMILY_NAMES` | recommended | e.g. `Lili,Ruby,Max` — used to pull the person out of an entry |
| `BOARD_TITLE` | no | Defaults to `The MRCL family Week` |
| `WEEK_STARTS_ON` | no | `1` for Monday (default), `0` for Sunday |
| `WEATHER_LATITUDE` / `WEATHER_LONGITUDE` | no | Defaults to Ōtāhuhu |
| `WEATHER_TIMEZONE` | no | Defaults to `Pacific/Auckland` |
| `WEATHER_ENABLED` | no | `false` hides the weather strip |

> A secret iCal address grants read access to that calendar to anyone holding
> it, so treat these like passwords. `netlify/functions/calendar.mjs` only
> fetches URLs on this list, so the endpoint cannot be pointed anywhere else.

Redeploy after changing any of these — they are read at build time.

### 2b-i. Let secrets scanning through

**Without this, the build fails.** Netlify scans the deployed files for the
values of environment variables and rejects the deploy if it finds one. The
calendar addresses end up in `public/config.generated.js` by design — that is
how a device is configured without anyone typing anything — so the scanner has
to be told they are expected:

| Variable | Value |
| --- | --- |
| `SECRETS_SCAN_OMIT_KEYS` | `CALENDAR_ICS_URLS,FAMILY_NAMES` |

Do **not** mark `CALENDAR_ICS_URLS` as a "secret" variable in Netlify: secret
variables are withheld from the deployed output, which is exactly where this
one has to end up.

If a deploy fails with *"Secrets scanning found secrets in build output"*, this
is the variable that is missing.

### 2c. How entries find their row

Nobody has to label anything. An entry picks its row from its own title:

| Calendar entry | Row | Shows as |
| --- | --- | --- |
| `Lili Ortho 8.20am` | Appointments | Ortho · Lili |
| `Soccer practice` | Sports | Soccer practice |
| `Family outing: Auckland Zoo` | Family activity | Auckland Zoo |
| `Bins out` | Chore | Bins out |

To force a row, prefix the entry: `Dinner: lasagne`, `Note: soccer cancelled`,
`Chore - mow lawns`. To pin a whole feed to one row, use the JSON form:

```json
[{"url":"https://calendar.google.com/…/basic.ics","category":"sport","label":"Ruby"}]
```

The keyword lists live in `public/js/classify.js` and are easy to extend.

Repeating events are expanded (daily, weekly with `BYDAY`, monthly, yearly,
with `INTERVAL`, `COUNT`, `UNTIL` and `EXDATE`). Times carrying a `TZID` are
read as local time, which is correct while the calendar and the screen share a
timezone.

Calendar entries are read-only on the board: they can be **ticked off** — which
is recorded against the week, not the calendar — but not edited or deleted
there. The calendar stays the single source of truth.

---

## 3. The screens

**The kitchen screen:** open `/` and leave it there. It shows the current week,
rolls over at midnight on its own, and reloads at 3am so a new deploy is picked
up overnight.

**Everyone's phone:** open `/add`, then Share → *Add to Home Screen* (iPhone) or
⋮ → *Add to Home screen* (Android). That is the entire setup.

The previous version's URLs redirect, so nothing has to be re-bookmarked:
`/tv-display.html` goes to the board and `/mobile-update.html` to `/add`.

---

## 4. Optional hardening

### Content-Security-Policy

Not enabled by default, on purpose: a CSP that is subtly wrong fails silently
in the browser, which is the exact failure mode that killed the last version.
Add this under the existing `[[headers]]` block in `netlify.toml` when you can
open the board straight afterwards and confirm it still loads:

```toml
Content-Security-Policy = "default-src 'self'; connect-src 'self' https://api.open-meteo.com; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'self'"
```

Dropping Firebase makes this much safer than it used to be — there is no
external script host left to allow.

### Who can reach the board

The site is unlisted rather than private: anyone with the URL can read and
write the week. That matched the previous version, and for a family board on an
obscure address it is usually fine. If you want it locked down, Netlify's
**Site configuration → Access control → Password protection** is one switch and
needs no code change.

---

## Troubleshooting

| What you see | What it means |
| --- | --- |
| "No calendars connected yet" in the footer | `CALENDAR_ICS_URLS` is not set, or the build ran before it was. Redeploy. |
| Board loads but is empty | Nothing on this week. Check the calendar, or add something from `/add`. |
| Calendar entries missing | The feed URL must match `CALENDAR_ICS_URLS` exactly — the proxy only forwards URLs on that list. |
| An entry is in the wrong row | Prefix it (`Dinner: …`) or add the keyword to `public/js/classify.js`. |
| "The board said 500" | The store call failed. Check the function log in Netlify. |
| "Too many people editing at once" | Two phones wrote to the same week at the same instant. It retries five times first; just try again. |
