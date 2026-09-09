# allengates01 Claude setup — drafts, not a finished install

Chris asked for a full audit-and-setup pass on `allengates01` (his Debian 13
box): Claude Code install, folder layout, global instructions, permissions,
skills, MCP, Cowork, and an rclone sync to the Brain Hub in Google Drive.

**This folder is not that.** It's the part of the job that could actually be
done from here: the drafts, plus scripts that let the on-box session audit,
apply and verify in minutes instead of re-deriving the plan.

## Why this session couldn't run the plan

The plan (phases summarised in `SETUP-LOG.md`) is written to run *on*
`allengates01` — it reads `~/.claude/`, runs `claude doctor`, checks
installed packages, edits `~/.claude/settings.json`, configures rclone and a
systemd timer, and drives Claude Desktop/Cowork.

This session is a cloud sandbox spun up against the `christo1384/christo1384`
GitHub repo. It has no access to `allengates01`'s filesystem, no way to run
commands on it, and no way to touch Claude Desktop or Cowork on that machine.
Anything claiming to be a Phase 0 audit result from this session would be
fabricated. So Phase 0 (audit), Phase 1 (install), most of Phase 2 (creating
`~/claude/` on the actual box), Phase 6 verification, Phase 7 (Cowork), Phase
8 (rclone/systemd), and Phase 9 (the checklist) all still need to happen in a
Claude Code session running **on `allengates01` itself** — a normal terminal
session there, not this one.

## What's in this folder instead

Content that doesn't depend on auditing the live machine — drafted and
checked against the current docs (`code.claude.com/docs/en/memory`,
`.../settings`, `.../permissions`) on 2026-09-02 and re-checked 2026-09-09:

- `claude-global/CLAUDE.md` — draft for `~/.claude/CLAUDE.md`
- `claude-global/rules/*.md` — draft for `~/.claude/rules/`
- `claude-global/settings.json` — draft for `~/.claude/settings.json`
- `project-template/` — the per-project skeleton from Phase 2 (`CLAUDE.md`,
  `.claude/`, `.gitignore`)
- `SETUP-LOG.md` — what was checked, what was drafted, what's still open
- `audit.sh` — read-only Phase 0 audit to run on the box first
- `system-audit.sh` — read-only box-hygiene audit (patches, fstab, memory,
  Docker limits, SSH, firewall, Samba, backups, secrets, disk); run once as
  your user and once with `sudo`, then work the `[WARN]` lines
- `REMEDIATION.md` — the fix for every `[WARN]` line `system-audit.sh` can
  print, in the order to work them
- `apply.sh` — applies `claude-global/` to `~/.claude/` and scaffolds
  `~/claude/` from the manifest. Dry run by default; `--apply` to execute.
  Backs up anything it overwrites, never deletes, refuses to run as root
- `brain-hub-sync/` — Phase 8: rclone user-timer templates and the setup
  steps for the Google Drive mirror
- `verify.sh` — Phase 9: PASS/FAIL checklist for everything above; exits
  non-zero until clean
- `backup/` — nightly restic-to-Drive user unit and timer, with the
  restore test that proves it works
- `compose/memory-limits.override.yml` — a memory limit for every
  container, sized so the box cannot be pushed into swap again
- `PHASE6-skills-mcp.md` — proposed global vs Steelcraft-only skill split
  (client-data rule), MCP server scopes, and the open decisions
- `claude-repo/` — open item 3: how to make `~/claude` a git repo that
  tracks the config and ignores every project folder, plus the rebuild-
  from-three-clones procedure

## How Chris applies this

On `allengates01`, in a real Claude Code (or Cowork) session:

1. Run `bash audit.sh` (read-only) and compare its output against what's
   here — it covers the Phase 0 checks from the plan.
2. Run `bash system-audit.sh`, then `sudo bash system-audit.sh`, and work
   the `[WARN]` lines using `REMEDIATION.md`.
3. Run `bash apply.sh` to see the plan, then `bash apply.sh --apply`. It
   copies `claude-global/` into `~/.claude/` as real files (Cowork skips
   symlinks), backs up anything already there, and scaffolds `~/claude/`
   with the project folders from the manifest.
4. `claude doctor`, then `/init` in each project folder to fill in its
   `CLAUDE.md`.
5. Follow `brain-hub-sync/README.md` for the rclone mirror (Phase 8), then
   Phases 5–7 (skills, MCP, Cowork test).
6. `bash verify.sh` until every automated check passes.

Everything here is a draft for Chris to read, edit, and approve before it
touches the live machine — nothing in this folder has been installed
anywhere.
