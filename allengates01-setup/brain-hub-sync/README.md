# Brain Hub sync — Phase 8 templates

Mirrors `~/claude/brain-hub-sync/` to the Brain Hub folder in Google Drive
on a timer, using rclone under a **user** systemd unit (no root, survives
logout once lingering is enabled). Nothing here is installed by
`apply.sh`; this is a manual step because it needs the rclone OAuth login,
which only Chris can do.

## One-time setup on the box

1. Install and log in (opens a browser URL; paste the code back):
   ```bash
   sudo apt install rclone
   rclone config          # New remote → name: gdrive → type: drive → default scope → auto config: n (headless), follow the URL
   chmod 600 ~/.config/rclone/rclone.conf
   ```
2. Confirm the remote and the target folder:
   ```bash
   rclone lsd gdrive:
   rclone mkdir "gdrive:Brain Hub/allengates01"
   ```
3. Install the units (edit the remote path in the `.service` file first if
   the Drive folder is named differently):
   ```bash
   mkdir -p ~/.config/systemd/user
   cp rclone-brain-hub.service rclone-brain-hub.timer ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now rclone-brain-hub.timer
   loginctl enable-linger "$USER"     # so the timer runs when you are not logged in
   ```
4. Test once by hand and read the log:
   ```bash
   systemctl --user start rclone-brain-hub.service
   journalctl --user -u rclone-brain-hub.service -n 30
   ```

## Direction and safety

- `rclone sync` is **one-way, local → Drive**, and deletes files in the
  Drive folder that no longer exist locally. That is the intended behaviour
  for a mirror, but it means the Drive copy is not a backup of local edits
  made in Drive. Edit in `~/claude/brain-hub-sync/` only.
- `--backup-dir` keeps anything deleted or overwritten for 30 days under
  `Brain Hub/allengates01-archive/<date>/`, so a bad sync is recoverable.
- `--dry-run` is in the service file's comments; run it once before the
  first real sync if the Drive folder already has content.
- The unit runs `rclone check` first and skips the sync if the remote is
  unreachable, so an offline box does not leave a half-mirrored folder.

## What to sync

Only finished deliverables (per `rules/workflows.md`). Working files stay
in the project folders. If a project's output needs to reach the Brain Hub,
copy it into `~/claude/brain-hub-sync/<project>/` and add the MANIFEST
line; the timer does the rest within 15 minutes.
