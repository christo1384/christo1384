# Weekends Back — website rebuild brief

**For:** the agent or contractor picking this up
**From:** Chris (technical) and Morgan (client relationships) — the two founders
**Site:** weekendsback.co.nz
**Brief written:** 16 Sep 2026, against the deploy of 22 Aug 2026

---

## 0. Read this first

This is not a redesign job. The positioning is good and the page is better
built than most small-business sites in New Zealand — dark mode done at token
level, `prefers-reduced-motion`, visible focus rings, a honeypot on the form,
real `<label>`s on every input. **Do not throw it away and start again.**

What the site is missing is narrower and more fixable: everything that turns a
visitor into an enquiry. There is no price, no proof, and no phone number, on a
page aimed at tradies — an audience that rings people and that has been burned
by open-ended consultant engagements.

The job is to close those gaps without losing the voice.

---

## 1. What the business is

Weekends Back sells **done-with-you AI automation** to Auckland trades and small
businesses with 1–15 people. The wedge is the "done *with* you, not *to* you"
promise: the client learns how the automation works while it is being built, so
they are not captive afterwards.

Three offers, currently listed in this order:

1. **Trade Pack** — sparkies, plumbers, builders, landscapers. Job intake,
   quoting, scheduling and invoicing wired together so a job is entered once.
2. **Client & Admin Flow** — studios, clinics, consultancies, retail. Booking
   confirmations, follow-ups, receipts, reminders.
3. **One Fix** — automate the single most annoying repeating task, as a
   low-commitment way in.

Founders: **Chris** (technical build & delivery), **Morgan** (client
relationships & operations).

### A prior-history note you should know about

Earlier in 2026, "Weekends Back" was an Airbnb turnover/cleaning service in
Māngere Bridge. The site that went live on 22 August is a different business
under the same name. Both are defensible and the name honestly fits either —
you are giving someone their weekend back in both cases — but they sell to
different buyers at different price points.

**Before writing any copy, get a straight answer from Chris and Morgan on
whether the cleaning business is retired, parked, or still running.** If both
are live they need separating, or one needs dropping. Everything in section 6
assumes the automation business is the one being pursued.

---

## 2. Current state, and what you are inheriting

The site had **no repository**. The entire page was one escaped HTML string
inside a Cloudflare Worker named `weekends-back`, last modified 22 Aug 2026.
That has been fixed as part of this handoff:

- `src/index.html` — the page, unpacked into an editable file. Start here.
- `src/index.js` — Worker entry, serves the HTML as a text import.
- `wrangler.toml` — working config; `wrangler dev` runs it locally.
- `baseline/deployed-2026-08-22.html` — frozen copy of what shipped. Never edit
  it; diff against it.

**Unverified:** nobody has confirmed that `weekendsback.co.nz` actually routes
to this Worker. Confirm before your first deploy — load the live site on a
phone and compare it with `wrangler dev`. If the live site is something else,
stop and raise it.

**Stack:** single static HTML page on a Cloudflare Worker. No build step, no
framework, no dependencies. **Keep it that way.** A one-page marketing site does
not need React, and the whole thing currently deploys in seconds. If you think
a task below requires a framework, you have misread the task.

### The design system — keep it

| Token | Light | Dark |
| --- | --- | --- |
| `--ink` | `#1C2430` | `#EDE9DD` |
| `--ink-soft` | `#333E4D` | `#C9C3B2` |
| `--paper` | `#F2EFE7` | `#14181D` |
| `--paper-dim` | `#E8E3D6` | `#1B2027` |
| `--card` | `#FBFAF6` | `#1B2027` |
| `--accent` | `#C87F2A` | `#E0A257` |
| `--accent-soft` | `#E3B57B` | `#8A5B24` |
| `--line` | `#D8D2C0` | `#333B44` |
| `--muted` | `#6C7268` (**fails contrast — see T9**) | `#8B9089` |

Typefaces: **Fraunces** (headings), **Public Sans** (body), **Space Mono**
(eyebrows, tags, fine print). Loaded from Google Fonts.

The clock illustration in the hero is hand-built inline SVG and is the only
piece of art on the page. Keep it.

---

## 3. What is working — do not "improve" these

Changing any of the following would make the site worse:

- **"Get your weekends back from the admin."** The headline earns the brand
  name instead of repeating it. Rare. Leave it alone.
- **The before/after pairs.** "I'll do the quote tonight — every night, for a
  week." That is a real sentence a real tradie has said, and it is the best
  writing on the page. Use *more* of this voice, not less.
- **"Done with you, not to you."** The genuine wedge — it separates them from
  the agencies that disappear and the SaaS that expects you to figure it out.
- **"1–15 people, Auckland."** Specific enough to be credible. Do not widen it
  to "SMEs" or "New Zealand".
- **The accessibility work.** Dark mode, reduced motion, focus rings, honeypot,
  semantic sections, labelled inputs. Preserve all of it through every change.

Voice: plain, direct New Zealand English. Second person. No "leverage", no
"solutions", no "streamline", no exclamation marks. When in doubt, read it out
loud and ask whether a builder in a ute would say it.

---

## 4. Blockers — you cannot finish without these answers

Get these from Chris and Morgan before you start writing. Several tasks below
are blocked on them, and **none of them may be invented, estimated, or filled
with placeholder text.**

| # | Question | Blocks |
| --- | --- | --- |
| B1 | **What does One Fix actually cost?** Need a real range, plus a starting-from figure for the two packs. Requires knowing the price floor and how long a One Fix genuinely takes. | T1 |
| B2 | **Which platforms can you genuinely support today?** Xero and MYOB seem safe. ServiceM8, Tradify, simPRO, AroFlo, Fergus — only if they can actually back it up. | T5 |
| B3 | **A phone number**, and the hours it will be answered. | T3 |
| B4 | **Is there a real client yet?** Named, with permission to publish, and real numbers. | T2 |
| B5 | **Is the cleaning business still live?** See section 1. | copy direction overall |
| B6 | **Cloudflare account access**, and confirmation the domain routes to this Worker. | any deploy |

If an answer does not arrive, **leave that section out and say so** — do not
ship an invented price, a made-up testimonial, or a platform logo they cannot
support. A tradie who rings about ServiceM8 and finds out you were guessing is
a lost client and a bad review.

---

## 5. Ground rules

1. **Never invent proof.** No stock testimonials, no "trusted by 50+
   businesses", no fake logos, no placeholder client names. This business's
   entire pitch is competence and honesty; a fabricated quote destroys both.
2. **Never invent a price.** See B1.
3. **Keep the accessibility.** Every change gets re-checked against the QA list
   in section 8.
4. **No new dependencies** without asking. No framework, no CSS library, no
   analytics SDK beyond what T7 specifies, no cookie banner.
5. **NZ English and NZ conventions.** "Organise", not "organize". NZ mobile
   format. GST mentioned where a price appears.
6. **Commit in small pieces**, one task per commit, message naming the task ID.
7. **Diff against the baseline** before every deploy.

---

## 6. The work

Ordered by what each item costs the business, not by how easy it is. T1–T4 are
the evening's work that matters most; the rest follow.

### T1 — Put a price on the page `blocked: B1`

**Problem.** There is no price anywhere. Step 02 of "How it works" says the
team will come back with "what each one costs", so the number only exists after
a conversation. A tradie deciding whether to fill in the form has no idea if
this is a $300 job or a $15,000 one — and the safe assumption is the expensive
one. For a buyer who has been burned before, silence on price does not read as
flexible. It reads as *"they'll work out what I can afford."*

**Do.** Add a real number to One Fix — "most One Fix jobs land between $X and
$Y" — and a starting-from figure on Trade Pack and Client & Admin Flow. State
whether figures include GST. Scoping still happens properly afterwards; this is
about clearing the first objection, not writing a contract.

**Done when:** a visitor who reads only the offer section knows roughly what
each of the three offers costs, and the numbers came from the founders.

---

### T2 — One real case study `blocked: B4`

**Problem.** No client name, no testimonial, no case study, no before-and-after,
no number anyone could check. The About section is honest about being early,
which is good — but "we're early" plus "no evidence" asks a stranger to go
first on faith alone.

**Do.** Build the section and the template now; fill it when the founders have
a client. One named case study beats ten anonymous testimonials. The shape:
trade, suburb, the specific task that was eating their time, what was built,
and the hours saved — with their name on it.

Standing recommendation to pass to the founders: do a One Fix for a mate's
business at cost, document the actual hours, publish it with permission. That
single section will convert better than anything else that could be written.

**Done when:** the section exists and renders correctly with real content — or
is absent entirely. Never present with placeholder copy.

---

### T3 — Phone number, and Open Graph tags `blocked: B3 (phone only)`

**Problem, part one.** The page is aimed at trades. Tradies ring. A form-only
contact route filters out exactly the buyer who would have called from the ute
at smoko and booked on the spot.

**Problem, part two.** The most likely first channel is one tradie sending the
link to another in WhatsApp, Messenger, or a Facebook trade group. With no
`og:title`, `og:description` or `og:image`, that share renders as a bare grey
URL — no headline, no picture, nothing that makes anyone tap it. About fifteen
lines in `<head>`. It is the highest effort-to-payoff item on this list.

**Do.**
- Mobile number in the header and in the contact band, as a `tel:` link.
- Set expectations so it does not ring all day: "Call or text — we pick up
  7am–6pm."
- Add `og:title`, `og:description`, `og:image`, `og:url`, `og:type`,
  `twitter:card`, and a canonical URL.
- Make a real OG image (1200×630). The clock illustration plus the headline is
  the obvious move — it is already on brand and already vector.

**Done when:** the number is tappable on a phone, and pasting the URL into a
link-preview debugger renders a card with the headline and image.

---

### T4 — Fix the email address

**Problem.** The contact block and the form both point at
`weekendsback2026@gmail.com`. They own the domain. A business whose pitch is
"we'll sort out your systems" quietly undercuts itself by not having sorted its
own email — and the `2026` reads as a placeholder somebody never came back to.

**Do.** `hello@weekendsback.co.nz`, forwarding to the same inbox. Cloudflare
Email Routing does this free, and they are already on Cloudflare. Update both
places in the page, and the form's destination.

**Done when:** no `gmail.com` string remains in `src/index.html`, and a test
send to the new address arrives.

Ten minutes. Cheapest credibility on this list.

---

### T5 — Name the software they already use `blocked: B2`

**Problem.** The page says "built around your existing tools". Competitors say
ServiceM8, simPRO, Tradify, AroFlo, Fergus, Xero, MYOB. A sparkie searching
"Tradify automation NZ" finds them, not Weekends Back. Naming platforms is also
the fastest way to signal you have actually done this before.

**Do.** Name the platforms the founders can genuinely support, in the Trade Pack
copy and in the page body text. **Only the ones they can back up** — see rule 1.

**Done when:** at least the confirmed platforms appear in body copy, and every
named platform has been confirmed by the founders.

---

### T6 — Take the form submission yourself, and say what happens to the data

**Problem.** The form posts to `formsubmit.co` with `_captcha` set to `false`.
It works, and the honeypot will catch lazy bots — but a prospective client's
operational details pass through a free third-party relay into a Gmail inbox,
with no privacy line anywhere on the page. For someone about to hand over access
to their systems, that is the wrong first signal.

**Do.**
- Short term: one line under the form saying what happens to their details.
- Proper fix: accept the POST in the Worker itself and forward it. They are
  already running a Worker, so this is a route, not a new service. Keep the
  honeypot, add a basic rate limit, and keep the existing `fetch`-based success
  and failure messages working (including the no-JS fallback).

**Done when:** a submission lands in the inbox without touching a third party,
the honeypot still rejects bots, and the form still works with JS disabled.

---

### T7 — Analytics, and an alert if the form goes quiet

**Problem.** They are testing a brand new positioning with no way to tell
whether anyone reads past the hero, which offer gets attention, or whether the
form has quietly stopped working. They would find out it was broken by noticing
the silence.

**Do.** Cloudflare Web Analytics — free, no cookie banner needed, already on
Cloudflare. Add a scheduled check that alerts if a week passes with zero
submissions.

**Done when:** pageviews are recorded, and a deliberately broken form triggers
the alert.

---

### T8 — Mobile navigation

**Problem.** Under 720px, `.navlinks a:not(.nav-cta)` is set to `display: none`
with nothing replacing it. Phone visitors get the brand and a "Get in touch"
button, and must scroll for everything else. It is one page so it is survivable
— but most of the traffic will be on a phone.

**Do.** Either a small menu, or keep the links and let them wrap. Do not just
hide them. Whatever you build must be keyboard-reachable and must respect
`prefers-reduced-motion`.

**Done when:** every nav destination is reachable at 360px wide, by touch and by
keyboard.

---

### T9 — Muted text fails contrast

**Problem.** `--muted: #6C7268` on `--paper: #F2EFE7` computes to **4.31:1**.
WCAG AA needs 4.5:1 for text at this size. It affects the hero note, the offer
tags, the struck-through "before" lines and the footer — all at 13–14px, where
it is hardest to read anyway. This figure was computed from the stylesheet's own
token values under WCAG 2.1 relative luminance, not estimated.

**Do.** Darken `--muted` to roughly `#5C6157`. Visually near-identical, clears
the bar. Check the dark-mode pair (`#8B9089` on `#14181D`) at the same time.

**Done when:** every text/background token pair on the page measures ≥ 4.5:1,
in both colour schemes.

---

### T10 — Make "done with you" the loudest thing after the headline

**Problem.** The real differentiator is not the automation — several competitors
do that. It is *done-with-you*: they teach it as they build it, so the client is
not captive afterwards. That is on the page, but it is stated once, in a section
heading most visitors will not reach.

**Do.** Promote it. Near the hero, in the offer section, and in whatever the
case study becomes. This is a copy and hierarchy change, not a new section.

**Done when:** a visitor who reads only the first screen understands that they
will be taught the system, not sold a black box.

---

### T11 — Reframe or earn the "2 evenings back" claim `blocked: B4`

**Problem.** "2 evenings back — avg. per week, first month" sits inside the hero
clock, styled as a measured result. The About section two screens later says
they are early. If a prospect asks "average across how many clients?", there is
no good answer yet — and that wobble is how a sales conversation with a
sceptical tradie ends.

**Do.** Either earn it via T2 and cite it — "Ben, sparkie, Onehunga: 2 evenings
a week" — or reframe as the target: "what we aim for in month one". Same
message, no exposure.

**Done when:** every number on the page is either attributed to a real client or
clearly framed as a goal.

---

### T12 — Structure for search, later

**Problem.** No service pages, no location page, no `LocalBusiness` structured
data. A single page competes for one query at best, in a field where several
competitors are already publishing.

**Do.** **Not urgent** — referral and outbound will outperform search at this
stage, and T1–T4 are worth more than all of this. When it is time, the shape
that works is separate pages per trade: "Automation for Auckland electricians",
"Automation for Auckland plumbers". Add `LocalBusiness` JSON-LD at the same
time.

**Done when:** deliberately deferred. Do not start this before T1–T9 are done.

---

## 7. Who they are up against

Verified by public web search, September 2026. Worth re-checking before acting
on positioning — this moves fast.

| Competitor | What they lead with | What it means |
| --- | --- | --- |
| **Arkham Solutions** | AI automation for trades & service businesses, NZ + AU. Names ServiceM8, simPRO, Tradify, AroFlo, Fergus, Xero, MYOB. | Closest competitor. They win the "does it work with my software" question before Weekends Back is in the room. This is why T5 matters. |
| **Automate The Trades** | AI job-management platform for tradies — quoting, scheduling, invoicing, chat-first. | Product, not service. Cheaper and faster to buy. The counter is the thing they cannot do: sitting in the ute with someone. |
| **Kanaky Tech** | AI automation agency, Auckland, SMEs and agencies. | Same buyer, broader positioning. The trades focus is sharper — lean on it. |
| **My Smart Office** | Virtual assistant admin for builders & tradies. | A person instead of a system. Different answer to the same pain; worth being able to argue against it. |

---

## 8. Definition of done

A change is not finished until all of this passes:

**Function**
- [ ] `wrangler dev` serves the page with no console errors.
- [ ] Form submits successfully and the success message shows.
- [ ] Form works with JavaScript disabled.
- [ ] Honeypot still rejects a bot submission.
- [ ] Every internal anchor link scrolls to its section.

**Responsive**
- [ ] 360px, 768px, 1280px, 1920px — no horizontal scroll at any width.
- [ ] All navigation reachable at 360px (T8).
- [ ] Tap targets at least 44×44px.

**Accessibility**
- [ ] Every text/background pair ≥ 4.5:1, light and dark (T9).
- [ ] Full keyboard traverse, visible focus ring at every stop.
- [ ] `prefers-reduced-motion: reduce` stops the scrolling strip and all
      transitions.
- [ ] Every input has a real, associated `<label>`.
- [ ] Heading order runs h1 → h2 → h3 with no skips.

**Both colour schemes**
- [ ] Light and dark both render correctly — check the contact band and the
      form, which invert.

**Sharing and search**
- [ ] OG card renders with headline and image in a link-preview debugger (T3).
- [ ] `<title>`, meta description and canonical URL all present and correct.

**Honesty**
- [ ] Every price came from the founders.
- [ ] Every client name and number is real and published with permission.
- [ ] Every named software platform is one they can genuinely support.
- [ ] No placeholder text anywhere in the shipped page.

**Process**
- [ ] Diffed against `baseline/deployed-2026-08-22.html`.
- [ ] Committed with the task ID in the message.

---

## 9. Out of scope

Do not do these without asking first:

- Rebranding, renaming, or changing the logo and colour palette.
- Rewriting the headline or the before/after pairs (section 3).
- Adding a framework, a build step, or a CMS.
- Adding a blog, a chatbot, a newsletter signup, or a booking calendar.
- Widening the target market beyond Auckland or beyond 1–15 people.
- Anything touching the Airbnb/cleaning side of the business until B5 is
  answered.

---

## 10. If you only do four things

If time runs out, this is the order that matters:

1. **Put a price on One Fix.** ~30 min. Removes the single biggest reason not to
   enquire.
2. **Set up `hello@weekendsback.co.nz`.** ~10 min, free. Biggest credibility
   gain per minute spent on this list.
3. **Phone number and Open Graph tags.** ~30 min. Opens the channel trades
   actually use, and makes shared links worth tapping.
4. **One real One Fix, written up with a real name.** A weekend. The only item
   here that fixes the trust problem properly, and the one that cannot be
   rushed.

The first three are an evening's work. The fourth is the one that matters.

---

## Provenance

The review this brief is built on was done by reading the deployed source
directly out of the Cloudflare Worker `weekends-back` (`index.js`, modified
22 Aug 2026), because the domain was unreachable from the machine doing the
review. That is shipped code, not a draft — but it means **nobody has visually
confirmed the live site**. Load it on a phone before you start.

The contrast figure in T9 was computed from the stylesheet's own token values
under WCAG 2.1 relative luminance. Competitor detail in section 7 came from
public web search in September 2026.
