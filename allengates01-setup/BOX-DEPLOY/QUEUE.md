# QUEUE — allengates01

One ticket per cycle, in this order. Dependencies must be `done`. The
agent edits only the Status column. Spec files are relative to
`allengates01-setup/`.

Status vocabulary: `ready` · `in-progress` · `done` · `partial: <left>` ·
`blocked: not in GO` · `blocked: ASK <question>` · `held`.

## Phase A — evidence (read-only)

| Ticket | Depends | Gate | What | Spec | Status |
|---|---|---|---|---|---|
| B01 | — | READ | Run `bash ../audit.sh` and save the full output to `evidence/B01-audit.txt`. Report the OS, RAM, whether `claude` is installed and how, and what exists under `~/.claude` and `~/claude`. | `audit.sh` | ready |
| B02 | B01 | READ | Run `bash ../system-audit.sh > evidence/B02-sysaudit-user.txt` then `sudo -n bash ../system-audit.sh > evidence/B02-sysaudit-root.txt`. In the report, list every `[WARN]` line verbatim and count them. If `findmnt --verify` reports a problem, copy its exact output into `evidence/B02-fstab.txt` for Chris. | `system-audit.sh` | ready |
| B03 | B02 | READ | Docker inventory: `docker compose -f ~/ai-stack/docker-compose.lite.yml config --services` (adjust the file name if the audit found a different one), `docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'`, `docker stats --no-stream`, and `docker inspect` memory limits per container. Save all to `evidence/B03-docker.txt`. Report which service names in `../compose/memory-limits.override.yml` do NOT exist in the real compose file. | `compose/memory-limits.override.yml` | ready |

## Phase B — safety net first

| Ticket | Depends | Gate | What | Spec | Status |
|---|---|---|---|---|---|
| B05 | B02 | FILE-WRITE | Pre-change snapshot: `mkdir -p ~/backups` and `tar czf ~/backups/config-<stamp>.tgz` of `~/ai-stack` (excluding any `data/` or volume dirs over 100 MB), `~/.config/rclone`, `~/.claude`, and copies of `/etc/fstab`, `/etc/samba/smb.conf` (read via `cat`, no sudo needed if world-readable). List the archive contents to `evidence/B05-contents.txt`. Verify: `tar tzf` succeeds and the archive is under 50 MB. | — | ready |
| B06 | B05 | PKG-INSTALL, FILE-WRITE, SERVICE-USER | Local restic backup, no Drive yet: `sudo -n apt install -y restic`; `mkdir -p ~/.config/restic && (umask 077; openssl rand -hex 32 > ~/.config/restic/password)`; `restic -r ~/backups/restic init`; copy `../backup/restic-backup.service` and `.timer` into `~/.config/systemd/user/`, editing `RESTIC_REPOSITORY` to `%h/backups/restic` and removing the `ExecCondition` line (no remote yet); `systemctl --user daemon-reload && systemctl --user enable --now restic-backup.timer`; run one backup by hand and `restic snapshots`. Verify: one snapshot listed; `restic restore latest --target /tmp/restore-test --include <one compose file>` and `diff` matches. Report the password file path (never its contents) so Chris can move it off-box. | `backup/` | ready |

## Phase C — home-scope config

| Ticket | Depends | Gate | What | Spec | Status |
|---|---|---|---|---|---|
| B07 | B06 | FILE-WRITE | `bash ../apply.sh` (read the plan), then `bash ../apply.sh --apply`, then `bash ../verify.sh > evidence/B07-verify.txt`. Report the FAIL lines. Phase 8 timer failures are expected here. | `apply.sh`, `verify.sh` | ready |
| B08 | B07 | FILE-WRITE | `chmod 600` every `~/*/.env` and `~/.config/rclone/rclone.conf` if present. Snapshot = `stat -c '%a %n'` of each before. Verify with `stat` after. | `REMEDIATION.md` § Secrets | ready |
| B09 | B07 | FILE-WRITE | Make `~/claude` a git repo: copy `../claude-repo/gitignore` to `~/claude/.gitignore`, `git init -b main`, `git add -A`, confirm `git status --porcelain` lists only `MANIFEST.md` and `.gitignore`, commit. No remote (Chris creates it). | `claude-repo/` | ready |
| B10 | B03 | COMPOSE-WRITE | Write `~/ai-stack/memory-limits.override.yml` from `../compose/memory-limits.override.yml`, keeping only services that exist per B03. `docker compose -f <main> -f memory-limits.override.yml config > /dev/null` must succeed. Do not start anything. Copy the final file to `evidence/B10-override.yml`. | `compose/` | ready |

## Phase D — system changes (sudo)

| Ticket | Depends | Gate | What | Spec | Status |
|---|---|---|---|---|---|
| B11 | B10, B06 | COMPOSE-APPLY | Apply the limits one service at a time: for each service in the override, `docker compose -f <main> -f memory-limits.override.yml up -d <service>`, wait 20 s, `docker ps` shows it Up. Snapshot = `docker inspect` of all containers before. Verify: `docker inspect --format '{{.HostConfig.Memory}}'` is non-zero for every service in the override. If a container fails to come up, `up -d` it again without the override file and mark `partial:`. | `REMEDIATION.md` § Docker | ready |
| B12 | B06 | PKG-INSTALL, SYS-CONFIG | `sudo -n apt install -y unattended-upgrades apt-listchanges`; write `/etc/apt/apt.conf.d/20auto-upgrades` with `APT::Periodic::Update-Package-Lists "1";` and `APT::Periodic::Unattended-Upgrade "1";` (snapshot the file first if it exists). Do NOT enable automatic reboot. Verify: `sudo -n unattended-upgrade --dry-run --debug 2>&1 \| tail -5` runs. | `REMEDIATION.md` § Patch state | ready |
| B13 | B06 | SYS-CONFIG | Write `/etc/sysctl.d/90-swappiness.conf` with `vm.swappiness=10`; `sudo -n sysctl --system`. Verify: `cat /proc/sys/vm/swappiness` prints 10. | `REMEDIATION.md` § Memory | ready |
| B14 | B06 | PKG-INSTALL, SYS-CONFIG | `sudo -n apt install -y python3-yaml smartmontools` so the audit's per-service compose view and SMART check work. Verify: `python3 -c 'import yaml'` and `smartctl --version`. | `system-audit.sh` | ready |
| B15 | B02 | SSH-HARDEN | Only if `~/.ssh/authorized_keys` has ≥ 1 key (else `blocked: ASK`): write `/etc/ssh/sshd_config.d/10-keys-only.conf` (PasswordAuthentication no, KbdInteractiveAuthentication no, PermitRootLogin no), `sudo -n sshd -t`, `sudo -n systemctl reload ssh`. Verify: `sudo -n sshd -T \| grep -i passwordauthentication` shows `no`. | `REMEDIATION.md` § SSH | ready |
| B16 | B15, B03 | FIREWALL | Determine the LAN range from `ip -4 addr` (e.g. 192.168.1.0/24). `sudo -n apt install -y ufw` if missing. Rules, in this order: `ufw default deny incoming`, `ufw default allow outgoing`, `ufw allow from <LAN> to any port 22 proto tcp`, then one allow from `<LAN>` per port that B03 showed published or `ss -tulnH` shows listening (445, 8123, 5678, 8096, and any *arr ports). Print `ufw show added` to the report, then `ufw --force enable`. Verify: `ufw status verbose`; from the box, `ss -tuln` unchanged. | `REMEDIATION.md` § Firewall | ready |
| B17 | B12 | PKG-UPGRADE | `sudo -n apt update && sudo -n apt full-upgrade -y`. Snapshot = `dpkg -l > snapshots/B17-<stamp>.txt` before. Report whether `/var/run/reboot-required` now exists (do NOT reboot) and whether `docker ps` still shows every container Up. | `REMEDIATION.md` § Patch state | ready |
| B18 | B17, B11 | READ | Re-run `sudo -n bash ../system-audit.sh > evidence/B18-sysaudit-final.txt`. Report the remaining `[WARN]` lines verbatim; each should map to a Needs-Chris item below. | `system-audit.sh` | ready |

## Needs-Chris (staged, not for the agent)

| Item | Why it waits | Evidence to look at |
|---|---|---|
| fstab parse error | Safety rule: never edit fstab unattended. Fix per `REMEDIATION.md` § Boot safety. | `evidence/B02-fstab.txt` |
| Secret rotation | Anything B02 flagged in shell history or compose files. Rotate at the provider, then clear. | `evidence/B02-sysaudit-user.txt` § Secrets |
| Google Drive login | `rclone config` needs a browser. Then repoint restic to `rclone:gdrive:backups/allengates01` and install the Brain Hub timer (`brain-hub-sync/README.md`). | — |
| restic password off-box | Copy `~/.config/restic/password` into a password manager. | B06 report |
| `~/claude` remote | Create a private repo and `git remote add origin`; push. | B09 report |
| Samba hardening | Home-network project, not this queue. | `evidence/B02-sysaudit-root.txt` § Samba |
| Ollama / Open WebUI | Stop them to reclaim ~7 GB, or keep. | `evidence/B03-docker.txt` |
| Reboot | If B17 left `/var/run/reboot-required`. | B17 report |
| Skills, MCP, Cowork | `PHASE6-skills-mcp.md`; needs the work machine and the desktop app. | — |
