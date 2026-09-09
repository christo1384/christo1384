# Runbook — bringing allengates01 to standard

One ordered checklist across every file in this folder. Tick as you go.
Estimated time: one evening for the box work, another for the Claude
Code phases. Each step names the file that has the detail.

Start on the box, in a terminal, as your own user:

```bash
git clone -b claude/linux-box-setup-l1qmkh https://github.com/christo1384/christo1384 ~/claude-setup
cd ~/claude-setup/allengates01-setup
```

## Session 1 — know the box (read-only, 15 min)

- [ ] `bash audit.sh > ~/audit-$(date +%F).txt` and read it
- [ ] `bash system-audit.sh > ~/sysaudit-user-$(date +%F).txt`
- [ ] `sudo bash system-audit.sh > ~/sysaudit-root-$(date +%F).txt`
- [ ] Count the `[WARN]` lines. That is the to-do list for Session 2.
- [ ] Anything surprising (a container you forgot, a port you don't
      recognise, a key in shell history): note it before touching anything.

## Session 2 — box standard (`REMEDIATION.md`, 1–2 h)

Work the warnings in this order; each one is in `REMEDIATION.md`.

- [ ] **Backups first.** `backup/README.md`: rclone login, restic init,
      timer, then the restore test. Everything below is safer with a
      backup that has been proven to restore.
- [ ] **fstab.** Fix the parse error, add `nofail,_netdev` to network
      mounts, move any inline credentials to a `.cred` file. Prove it with
      `sudo findmnt --verify` and `sudo mount -a`, not with a reboot.
- [ ] **Memory.** Copy `compose/memory-limits.override.yml` next to the
      compose file, check the service names against
      `docker compose config --services`, apply, and decide whether Ollama
      stays up. Set `vm.swappiness=10`.
- [ ] **Secrets.** Rotate anything the audit found in history or compose
      files. `chmod 600` every `.env` and `rclone.conf`.
- [ ] **SSH.** Keys on from the Mac and PC first, then password auth off.
      Test a fresh login before closing the current one.
- [ ] **Firewall.** ufw default deny, allow LAN to the ports you use.
      Remember Docker-published ports bypass it; bind admin UIs to the LAN
      or localhost address in compose.
- [ ] **Samba.** Guest off, `server min protocol = SMB2`.
- [ ] **Patches.** `apt full-upgrade`, enable unattended security
      upgrades, reboot at a quiet moment.
- [ ] Re-run `sudo bash system-audit.sh` and confirm the `[WARN]` count is
      zero or every remaining one is a deliberate choice.

## Session 3 — Claude Code (30 min)

- [ ] `bash apply.sh` and read the plan
- [ ] `bash apply.sh --apply`
- [ ] `claude doctor`
- [ ] `claude` in `~/claude`, confirm it reads the global CLAUDE.md and
      the four rules (ask it what rules it has loaded)
- [ ] `cd ~/claude/<project> && claude`, then `/init`, for each project
      folder. Trim what `/init` writes; keep the five headings from the
      template.
- [ ] Update each project's status line in `~/claude/MANIFEST.md`
- [ ] `claude-repo/README.md`: make `~/claude` a git repo with the
      provided `.gitignore`, push to a private remote
- [ ] `bash verify.sh` — expect the Phase 8 timer checks to fail until
      Session 4 installs it (rclone is already there from the backup step),
      and Phase 7 to be manual. Everything else should pass.

## Session 4 — sync, skills, MCP, Cowork (45 min)

- [ ] `brain-hub-sync/README.md`: install the rclone timer, test one
      sync by hand, read the journal
- [ ] `PHASE6-skills-mcp.md`: copy the agreed global skills across,
      `claude mcp add` the agreed servers at user scope
- [ ] Cowork: open it on `~/claude`, ask it to read `~/.claude/CLAUDE.md`,
      confirm it sees the rules (symlinked files are skipped; `apply.sh`
      wrote real files)
- [ ] `bash verify.sh` until every automated check passes
- [ ] Add a dated entry to `SETUP-LOG.md` saying what was applied and
      what was skipped on purpose, commit, push

## Decisions still needed from Chris

From `SETUP-LOG.md` and `PHASE6-skills-mcp.md`:

1. Claude Code billing: API key or subscription login.
2. Confirm the global vs Steelcraft-only skill split.
3. Which MCP servers at user scope.
4. Keep Ollama running, or stop it and reclaim the RAM.

## When it is done

- `sudo bash system-audit.sh` prints no `[WARN]`, or each one is explained
  in the setup log.
- `bash verify.sh` exits 0.
- A restore from the restic backup has been performed at least once.
- PR #4 is merged and PR #2 is closed.
