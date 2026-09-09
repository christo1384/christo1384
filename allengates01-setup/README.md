# allengates01 Claude setup — drafts, not a finished install

Chris asked for a full audit-and-setup pass on `allengates01` (his Debian 13
box): Claude Code install, folder layout, global instructions, permissions,
skills, MCP, Cowork, and an rclone sync to the Brain Hub in Google Drive.

**This folder is not that.** It's the part of the job that could actually be
done from here.

## Why this session couldn't run the plan

The plan (see `SETUP-LOG.md` for the full text) is written to run *on*
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
`.../settings`, `.../permissions`) as of 2026-09-02:

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

## How Chris applies this

On `allengates01`, in a real Claude Code (or Cowork) session:

1. Run `bash audit.sh` (read-only) and compare its output against what's
   here — it covers the Phase 0 checks from the plan.
2. Copy `claude-global/CLAUDE.md` to `~/.claude/CLAUDE.md` **as a real file,
   not a symlink** (Cowork skips symlinked user-scope files).
3. Copy `claude-global/rules/` to `~/.claude/rules/`.
4. Review `claude-global/settings.json` against `claude doctor` output, then
   copy to `~/.claude/settings.json`.
5. Use `project-template/` as the starting point for each project folder in
   Phase 2, then continue with Phases 5–9 for real, on the machine.

Everything here is a draft for Chris to read, edit, and approve before it
touches the live machine — nothing in this folder has been installed
anywhere.
