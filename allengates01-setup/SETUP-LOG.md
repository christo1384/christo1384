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

## 2026-09-09 — second pass, still from a cloud session

**What was asked**: check the box's setup state.

**What was found**: nothing from the 2026-09-02 pass had been applied yet —
every phase that needs the machine is still open, and this session still
cannot reach `allengates01`. Reviewed the drafts against the current docs
instead (settings reference, permissions, memory). Every key and rule in
`settings.json` is valid as written. One weak spot fixed:

- `Bash(rm -rf /*)` only blocked that exact argument shape; the permissions
  docs warn that argument-constraining Bash patterns are fragile. Replaced
  with blanket denies on `rm -rf *`, `rm -fr *` and `rm -r *`. Trade-off:
  Claude Code can no longer recursive-delete anywhere, project folder
  included — Chris does those by hand. That matches the intent of
  `rules/safety.md` better than the old rule did.

**Added**: `audit.sh` — the Phase 0 audit as a read-only script, so the
on-box session (or Chris in a plain terminal) can run it once and paste the
output, rather than re-deriving the audit commands from the plan. It reports
OS/RAM/swap, tool versions and install method for `claude`, what already
exists under `~/.claude/` (including whether `CLAUDE.md` is a symlink, which
Cowork skips), `~/claude/` layout, Claude Desktop presence, rclone remotes
and timers, fstab parse state, and the n8n/sandbox containers from the vault
deployment record. It changes nothing.

**Still open**: everything listed under "Still fully open" above. Next step
is unchanged — run `audit.sh` on `allengates01`, compare, then apply.

**Added (same day)**: `system-audit.sh` — the box-hygiene half of "get the
box to a good standard", as a read-only script. The setup plan only ever
covered Claude Code; the box also runs Docker (n8n + privileged sandbox
runner, Jellyfin, the *arr stack, Home Assistant, Ollama), Samba to two
other machines, and has already OOM-killed twice on 15 GB with heavy swap.
The script flags: pending patches and whether unattended-upgrades is on,
fstab parse state and network mounts without `nofail`, swap pressure and
kernel OOM events in the last 30 days, containers with no memory limit or
running privileged, ports published on 0.0.0.0, sshd password/root login,
ufw state and services listening on all interfaces, Samba guest access and
min protocol, presence of any backup timer/cron, secrets in shell history
and compose files, `.env` and rclone.conf modes, and disk usage. Every
`[WARN]` line is a to-do for the system-standard session. Root-only checks
say so and ask for a `sudo` re-run rather than guessing.
