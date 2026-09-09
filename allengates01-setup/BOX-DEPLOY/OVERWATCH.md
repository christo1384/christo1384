# OVERWATCH — directive inbox

Newest at the bottom. The agent reads this bottom-up at the start of every
cycle. Directives:

- `STOP` — finish nothing, exit.
- `HOLD Bxx` — do not take that ticket.
- `REDO Bxx: <why>` — that ticket is ready again; read the why first.
- `NOTE: <text>` — information only.

---

NOTE: 2026-09-10 08:40 NZST — queue created from a cloud session; no cycle has run yet. First cycle should be B01 (read-only audit).
