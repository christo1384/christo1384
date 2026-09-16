# weekendsback.co.nz

Marketing site for **Weekends Back** — done-with-you automation for Auckland
trades and small businesses.

## What this is

Until now the site had no repository. The whole page lived as a single escaped
HTML string inside a Cloudflare Worker named `weekends-back` (last modified
22 Aug 2026). This directory is that site, recovered from the deployed Worker
and unpacked into files you can actually edit.

| Path | What it is |
| --- | --- |
| `src/index.html` | The site. Edit this. |
| `src/index.js` | Worker entry point — serves `src/index.html`. |
| `baseline/deployed-2026-08-22.html` | Frozen copy of what is live as of 22 Aug 2026. **Do not edit.** Reference only, so any change can be diffed against what was shipped. |
| `wrangler.toml` | Worker config. |
| `HANDOFF.md` | The rebuild brief. Start there. |

`src/index.html` and `baseline/deployed-2026-08-22.html` are identical at the
first commit. They diverge as soon as the rebuild starts — that divergence is
the changelog.

## Run it locally

```
npm install -g wrangler     # or: npx wrangler ...
wrangler dev                # http://localhost:8787
```

## Deploy

```
wrangler deploy
```

Requires Cloudflare credentials for the account that owns the `weekends-back`
Worker. Ask Chris.

## One caveat on provenance

The source here was read back out of the deployed Worker, not exported from an
existing repo — no repo existed. It has been structurally checked (element
counts, balanced tags, all known copy strings present), but nobody has yet
confirmed that `weekendsback.co.nz` actually routes to this Worker rather than
to something else. Confirm that before the first deploy: load the live site,
compare it against `wrangler dev`.
