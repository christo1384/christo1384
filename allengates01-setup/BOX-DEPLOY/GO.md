# GO — write classes for the allengates01 deploy agent

Chris: read the classes, delete any line you do not want executed, change
`UNSIGNED` to `SIGNED` below, commit and push. That is the say-so. The
agent refuses every ticket whose class is missing from this list or while
the status reads UNSIGNED.

| Class | Limit |
|---|---|
| READ | Read-only commands and the audit scripts. Output goes to `evidence/`. |
| FILE-WRITE | Files under `$HOME` only: `~/.claude/`, `~/claude/`, `~/backups/`, `~/.config/systemd/user/`, `~/.config/restic/`, and permission changes (`chmod 600`) on `~/*/.env` and `~/.config/rclone/rclone.conf`. Always with a snapshot. |
| PKG-INSTALL | `sudo apt install` of exactly: `restic`, `unattended-upgrades`, `apt-listchanges`, `ufw`, `python3-yaml`, `smartmontools`. Nothing else. |
| SYS-CONFIG | New or replaced drop-in files under `/etc/sysctl.d/`, `/etc/apt/apt.conf.d/`, `/etc/ssh/sshd_config.d/` only, with the previous file snapshotted first. Nothing else under `/etc` is touched. |
| COMPOSE-WRITE | Write `memory-limits.override.yml` next to the compose file and validate with `docker compose config`. No containers touched. |
| COMPOSE-APPLY | `docker compose up -d <service>` per named service to apply memory limits. Containers restart one at a time. Never `down`. |
| SERVICE-USER | `systemctl --user` enable/start of the restic and rclone units, `loginctl enable-linger`. |
| FIREWALL | `ufw` default deny incoming, allow from LAN ranges to listed ports, `ufw enable`. **Lockout risk: SSH port is allowed first and the rule set is printed before enable.** |
| SSH-HARDEN | Drop-in disabling password auth and root login, only when an authorized key exists. `sshd -t` before reload. |
| PKG-UPGRADE | `sudo apt update && sudo apt full-upgrade -y`. No reboot. |

## Still off-limits (not a class, not signable here)

- `/etc/fstab` edits (the known parse error) — staged for Chris with evidence.
- Samba config — the home-network project's job.
- Secret rotation — Chris does it at each provider.
- `rclone config` / Google Drive login — needs a browser.
- Reboot.
- Stopping Ollama / Open WebUI.
- Any deletion.

Status: **UNSIGNED**
