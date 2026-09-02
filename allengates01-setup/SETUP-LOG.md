# Setup log — allengates01 Claude Code / Cowork setup

## 2026-09-02 — first pass, from a cloud session

**What was asked**: a full audit-and-setup pass on `allengates01` per the
9-phase plan Chris wrote (binary install, folder layout, global
instructions, permissions, skills, MCP, Cowork, Brain Hub rclone sync,
verification checklist).

**What actually happened**: this session runs in a cloud sandbox against the
`christo1384/christo1384` GitHub repo, not on `allengates01`. It has no
filesystem access to that machine, can't run `claude doctor` there, can't
check installed packages, rclone remotes, or existing `~/claude/` layout on
it, and can't touch Claude Desktop/Cowork at all. Per the plan's own ground
rule ("audit before you touch, never assume something isn't installed") and
its instruction to stop and report before Phase 1, none of Phase 0 could be
run honestly from here — so it wasn't run, and nothing was installed or
changed on any real machine.

**What was done instead** (see `allengates01-setup/` in this repo):
- Verified the settings.json and CLAUDE.md content in the plan against the
  live docs (`code.claude.com/docs/en/memory`, `.../settings`,
  `.../permissions`), 2026-09-02. Two corrections from the plan's own draft:
  - `Bash(git status*)` → `Bash(git status *)` (space before the trailing
    `*` — without the space, a bare `git status` with no arguments isn't
    guaranteed to match the same way; the docs' own examples all use the
    space form). Applied the same fix to the other `Bash(...)` allow rules.
  - Confirmed the Cowork symlink behaviour Phase 3/7 describes is accurate
    as of the current docs: Cowork skips a `~/.claude/CLAUDE.md` that is
    itself a symlink or hard link, and skips imports/rules that resolve
    outside the session's working folder.
- Drafted `claude-global/CLAUDE.md`, `claude-global/rules/*.md`,
  `claude-global/settings.json` — ready to review and copy onto the machine.
- Drafted `project-template/` (CLAUDE.md skeleton, `.gitignore`,
  `.claude/skills/`) for Phase 2/5.
- Drafted `MANIFEST-template.md` with the six known projects from the plan.

**Still fully open** (needs a session running on `allengates01` itself):
- Phase 0 audit (all of it — `claude`, `claude doctor`, existing
  `~/.claude/`, npm vs native install, node/git/gh/python3/rclone, existing
  project folders, Claude Desktop/Cowork presence).
- Phase 1 (binary install/login), Phase 2 (creating `~/claude/` for real —
  don't duplicate whatever Phase 0 finds), Phase 5 (per-project `/init` +
  trim), Phase 6 (skills export/import, MCP `claude mcp add`), Phase 7
  (Cowork working-folder test), Phase 8 (rclone config + systemd timer),
  Phase 9 (the full verification checklist).

**Open items for Chris to decide** (unchanged from the plan, listed here so
they're not lost):
1. API-key billing for Claude Code, or subscription login?
2. Which custom skills should be global vs Steelcraft-only?
3. Should `~/claude/` itself be a git repo (config backup), excluding
   project folders?
4. fstab parse error / read-only Mac share — confirmed separate job, not
   touched here.
5. OpenClaw Phase 1 (token rotation) — confirmed separate job, not touched
   here.

**Next step**: run this plan again in a Claude Code session started on
`allengates01` itself (terminal `claude`, or a Cowork session pointed at
`~/claude/`). That session can do the real Phase 0 audit, compare it
against the drafts in `allengates01-setup/`, and carry the plan through
Phases 1–9 for real.
