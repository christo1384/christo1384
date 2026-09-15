# Deploying the family week

Everything here is done **once**, by one person. Nobody in the house has to set
up anything on their own phone — that was the flaw in the previous version.

---

## 1. Firebase

The app talks to one Firestore database. The existing `allen-gates-family`
project can be reused as-is; its data carries over.

### 1a. Turn on Anonymous sign-in

Firebase console → **Authentication** → **Sign-in method** → **Anonymous** →
enable.

Every device signs in silently on load. Nobody sees a login screen. This exists
so the security rules can require an authenticated caller and refuse anonymous
HTTP requests hitting the REST API directly.

> If this is skipped, the board shows: *"Turn on Anonymous sign-in in the
> Firebase console."*

### 1b. Deploy the security rules

`firebase/firestore.rules` is the file that actually protects the family's data.
The checks in the app itself only exist to give a friendly error message.

```sh
firebase deploy --only firestore:rules --project allen-gates-family
```

Or paste the file into Firebase console → **Firestore Database** → **Rules** →
**Publish**.

The rules allow reads and writes only to the `items` collection, only from a
signed-in caller, and only for documents of the right shape (title 1–120
characters, a known category, a real `YYYY-MM-DD` date, and so on). Everything
else in the project is closed.

> If `FIRESTORE_COLLECTION` is changed away from `items`, change the match path
> in the rules to suit.

### 1c. Copy the web config

Firebase console → **Project settings** → **Your apps** → the web app → **SDK
setup and configuration** → **Config**. You want the object that looks like:

```js
{ apiKey: "…", authDomain: "…", projectId: "…", storageBucket: "…", messagingSenderId: "…", appId: "…" }
```

---

## 2. Netlify

### 2a. Connect the repository

Netlify picks the settings up from `netlify.toml`; they should already read:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |

### 2b. Set the environment variables

**Site configuration → Environment variables.** Only the first one is required.

| Variable | Required | What it is |
| --- | --- | --- |
| `FIREBASE_CONFIG` | **yes** | The config object from step 1c, as one line of **JSON** |
| `CALENDAR_ICS_URLS` | no | Calendar feeds, comma or newline separated (see below) |
| `BOARD_TITLE` | no | Defaults to `The MRCL family Week` |
| `WEEK_STARTS_ON` | no | `1` for Monday (default), `0` for Sunday |
| `WEATHER_LATITUDE` / `WEATHER_LONGITUDE` | no | Defaults to Ōtāhuhu |
| `WEATHER_TIMEZONE` | no | Defaults to `Pacific/Auckland` |
| `WEATHER_ENABLED` | no | `false` hides the weather strip |
| `FIRESTORE_COLLECTION` | no | Defaults to `items` |

`FIREBASE_CONFIG` must be **valid JSON**, so every key needs quotes — which the
snippet Firebase shows you does not have. It should look like this, all on one
line:

```json
{"apiKey":"…","authDomain":"…","projectId":"…","storageBucket":"…","messagingSenderId":"…","appId":"…"}
```

If JSON is awkward, set the six individual variables instead and leave
`FIREBASE_CONFIG` unset: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`,
`FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`,
`FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`.

### 2c. Deploy

Trigger a deploy. The build log should say:

```
[build-config] wrote public/config.generated.js (Firebase from environment, 0 calendar feed(s))
```

If it says `Firebase from nothing`, the environment variable has not been
picked up and the site will show its setup message.

---

## 3. The screens

**The kitchen screen:** open `/` and leave it there. It shows the current week,
rolls over at midnight on its own, and reloads at 3am so a new deploy is picked
up overnight.

**Everyone's phone:** open `/add`, then Share → *Add to Home Screen* (iPhone) or
⋮ → *Add to Home screen* (Android). That is the entire setup. No gear icon, no
keys, nothing to paste.

Old home-screen icons pointing at `/mobile-update.html` are redirected to
`/add`, so they keep working.

---

## 4. Calendar feeds (optional)

In Google Calendar → the calendar's **Settings** → **Integrate calendar** →
**Secret address in iCal format**. Copy that URL.

Set `CALENDAR_ICS_URLS` to one or more of them, comma separated. Those events
appear on the board as read-only entries — the phone page shows them with a 🗓
and offers no Edit or Delete, because the calendar owns them.

By default they land in the **Appointments** row. To send a feed somewhere else,
put JSON in `CALENDAR_ICS_URLS` instead of a plain list:

```json
[{"url":"https://calendar.google.com/…/basic.ics","category":"sport","label":"Ruby"}]
```

> Anyone with a secret iCal address can read that calendar, so treat these like
> passwords. `netlify/functions/calendar.mjs` only ever fetches URLs that are in
> this list, so the endpoint cannot be pointed at anything else.

Repeating events are expanded (daily, weekly with `BYDAY`, monthly, yearly,
with `INTERVAL`, `COUNT`, `UNTIL` and `EXDATE`). Times carrying a `TZID` are
read as local time, which is correct while the calendar and the screen are in
the same timezone.

---

## Optional hardening

### Content-Security-Policy

Not enabled by default, on purpose: a CSP that is subtly wrong fails silently
in the browser, which is the exact failure mode that killed the last version.
Add this to `netlify.toml` under the existing `[[headers]]` block when you can
open the board straight afterwards and confirm it still loads:

```toml
Content-Security-Policy = "default-src 'self'; script-src 'self' https://www.gstatic.com; connect-src 'self' https://*.googleapis.com https://api.open-meteo.com; img-src 'self' data:; style-src 'self'; base-uri 'self'; frame-ancestors 'self'"
```

If the board goes blank after adding it, the browser console will name the
blocked host; add that host to the matching directive, or remove the header
again.

### Firebase App Check

App Check ties the Firebase project to your own domains, so the keys are
useless from anywhere else. Worth doing if the site ever gets a public custom
domain. It needs a reCAPTCHA site key and a matching change in
`public/js/firebase.js`.

---

## Troubleshooting

| What you see | What it means |
| --- | --- |
| "This deploy has no Firebase configuration" | `FIREBASE_CONFIG` is not set, or is not valid JSON. Check the build log. |
| "Turn on Anonymous sign-in…" | Step 1a was skipped. |
| "Firestore refused the read" | The rules in step 1b are not deployed, or the collection name does not match. |
| "Could not load Firebase" | The screen has no internet, or something is blocking `gstatic.com`. |
| Board loads, but is empty | Nothing is on this week yet. Add something from `/add`. |
| Calendar events missing | Check `CALENDAR_ICS_URLS` matches the feed URL exactly — the proxy only forwards URLs on that list. |
