# Nightly backup — restic to Google Drive via rclone

Covers the `no backup timer or cron job found` warning. Same shape as the
Brain Hub sync (user systemd unit + timer, no root), so once one works the
other does too. Requires the `gdrive:` rclone remote from
`../brain-hub-sync/README.md` to exist first.

## What gets backed up

Small, config-only. Media and downloads are not in scope; they are
re-downloadable and would blow the Drive quota.

| Path | Why |
|---|---|
| `~/ai-stack` | compose files, `.env`, n8n data volume bind-mounts if any |
| `~/homeassistant` (or wherever HA's config lives) | automations, secrets.yaml |
| `~/claude` | project folders and MANIFEST (brain-hub-sync is already mirrored, harmless to include) |
| `~/.config/rclone` | the Drive token; without it a restore cannot reach the backups |
| `/etc/samba`, `/etc/fstab`, `/etc/ssh/sshd_config.d` | the hand-edited system config |

The `/etc` paths need read access; the unit runs as your user, so either
add yourself to the relevant groups or keep a root-readable copy in
`~/etc-snapshot` refreshed by a tiny root cron (`cp -a`). The simpler
route: `sudo chmod o+r /etc/fstab /etc/samba/smb.conf` is fine for those
two, they contain no secrets once fstab credentials live in a `.cred`
file.

Edit `BACKUP_PATHS` in the `.service` file to match what actually exists;
`restic` errors on a missing path.

## One-time setup

```bash
sudo apt install restic
rclone mkdir gdrive:backups/allengates01

# Repository password: generate, store in a 600 file, never type it into chat.
mkdir -p ~/.config/restic && (umask 077; openssl rand -hex 32 > ~/.config/restic/password)
export RESTIC_REPOSITORY=rclone:gdrive:backups/allengates01
export RESTIC_PASSWORD_FILE=~/.config/restic/password
restic init

mkdir -p ~/.config/systemd/user
cp restic-backup.service restic-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now restic-backup.timer
loginctl enable-linger "$USER"
```

Then **write the repository password down somewhere that is not this
box** (password manager). Without it the backups are unreadable, and the
password file is on the disk being backed up.

## Prove it restores

Do this once now and once a quarter:

```bash
systemctl --user start restic-backup.service
journalctl --user -u restic-backup.service -n 20
restic snapshots
restic restore latest --target /tmp/restore-test --include ~/ai-stack/docker-compose.lite.yml
diff /tmp/restore-test/$HOME/ai-stack/docker-compose.lite.yml ~/ai-stack/docker-compose.lite.yml && echo "restore OK"
```

## Retention

`restic forget --prune` in the unit keeps 7 daily, 4 weekly, 6 monthly
snapshots. Config backups are tiny; this costs well under 1 GB on Drive.
