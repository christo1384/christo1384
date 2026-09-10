# Remediation playbook — allengates01

Each `[WARN]` line `system-audit.sh` can print, and the fix for it. Work
these on the box, in a Claude Code session or by hand, top to bottom. Every
fix here is reversible or backed up first. Nothing in this file has been
run anywhere yet.

Ground rules from `claude-global/rules/safety.md` still apply: audit before
touching, ask before editing `/etc/fstab`, sudoers or network config, never
commit secrets.

---

## Patch state

**`N packages upgradable`**

```bash
sudo apt update && sudo apt full-upgrade
```
Check `docker ps` afterwards; a kernel or containerd update can restart the
Docker daemon and every container with it.

**`reboot required`**

Pick a quiet moment (nothing streaming on Jellyfin, no n8n runs), then
`sudo reboot`. Confirm all containers came back: `docker ps` should match the
list from before.

**`unattended-upgrades not installed` / `not enabled`**

```bash
sudo apt install unattended-upgrades apt-listchanges
sudo dpkg-reconfigure -plow unattended-upgrades   # answer Yes
```
Debian's default config applies security updates only, which is the right
setting for this box. Do not enable `Unattended-Upgrade::Automatic-Reboot`;
reboots stay manual so Home Assistant and the media stack are not knocked
over at 6am.

## Boot safety

**`findmnt --verify reports problems`**

This is the known fstab parse error. It is a separate job, but it is also
the single most dangerous item on the list: a malformed fstab can drop the
box to an emergency shell on the next reboot. Procedure:

1. `sudo cp /etc/fstab /etc/fstab.bak-$(date +%F)`
2. Read the `findmnt --verify` output; it names the bad line.
3. Fix only that line. For a CIFS/SMB share the shape is:
   ```
   //mac.local/Share  /mnt/mac  cifs  credentials=/etc/samba/mac.cred,uid=1000,gid=1000,nofail,_netdev,x-systemd.automount  0  0
   ```
4. `sudo findmnt --verify` until clean, then `sudo systemctl daemon-reload`
   and `sudo mount -a` to prove it mounts without a reboot.

**`a network mount lacks nofail/_netdev`**

Add `nofail,_netdev` to that line's options (same procedure as above).
Without them, boot blocks waiting for a share that may be off.

**`credentials appear inline in /etc/fstab`**

Move `username=`/`password=` into `/etc/samba/<host>.cred` (two lines:
`username=...`, `password=...`), `sudo chmod 600` it, and replace the inline
values with `credentials=/etc/samba/<host>.cred`.

## Memory budget

**`swap in use exceeds a quarter of RAM`** and **`OOM-killer events`**

The box has 15 GB and has already OOM-killed twice with ~10 GB of swap in
use. Swap is not spare RAM; when a container gets paged out its latency
goes through the floor and the kernel starts killing things. Two steps:

1. Give every container a memory limit (next section). Uncapped
   containers are what let one service push the rest into swap.
2. Decide what actually needs to run. Ollama and Open WebUI are the largest
   idle consumers and the AI Assistant no longer uses Ollama (it moved to
   OpenRouter). If nothing else calls Ollama, `docker compose stop ollama
   open-webui` and reclaim several GB. Keep the compose entries; just
   don't auto-start them.

Then lower swappiness so the kernel prefers dropping cache over swapping
out processes:

```bash
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-swappiness.conf
sudo sysctl --system
```

## Docker

**`<container>  NO LIMIT`**

In the compose file for that service:

```yaml
    mem_limit: 512m        # compose v2 honours this without swarm
    memswap_limit: 512m    # same value = no swap for this container
```

Starting points for this box (adjust from `docker stats` after a day):

| Service | Limit |
|---|---|
| n8n | 1g |
| sandbox-api | 256m (already set) |
| sandbox-runner-1 | 1.5g (already set) |
| jellyfin | 2g |
| sonarr / radarr / prowlarr | 512m each |
| qbittorrent | 1g |
| homeassistant | 1g |
| ollama | 6g, or stopped (see above) |
| open-webui | 1g, or stopped |

Apply with `docker compose up -d <service>`; compose recreates only that
container.

**`PRIVILEGED`**

`sandbox-runner-1` is Docker-in-Docker and needs it. Anything else flagged
privileged should be reviewed: most media containers only need a device
mapping or a capability, not full privilege.

**`containers publish on 0.0.0.0`**

Docker's published ports bypass ufw. For services only you use from the
LAN this is acceptable, but be deliberate: bind admin UIs to the LAN
address (`"192.168.x.y:5678:5678"`) or to localhost if they sit behind a
reverse proxy. Anything that must never be reachable from a guest WiFi
network gets bound to localhost.

**`N dangling images`**

`docker image prune` (dangling only, safe). Do not run `docker system
prune -a` on this box; it removes stopped containers' images, including
the Ollama one you may want back.

## SSH

**`password authentication is yes`**

First confirm you have a working key login from at least one other
machine, or the next step locks you out. Then:

```bash
sudo tee /etc/ssh/sshd_config.d/10-keys-only.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl reload ssh
```
Keep the current session open and test a fresh login before closing it.

**`no ~/.ssh/authorized_keys`**

From the Mac or Windows PC: `ssh-copy-id <your-user>@allengates01` (or paste the
public key into `~/.ssh/authorized_keys`, mode 600, directory mode 700).
Do this before the step above.

## Firewall

**`no ufw or nftables found`**

```bash
sudo apt install ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp   # adjust to your LAN
sudo ufw allow from 192.168.0.0/16 to any port 445 proto tcp  # samba
sudo ufw allow from 192.168.0.0/16 to any port 8123 proto tcp # home assistant
sudo ufw enable
```
Add a rule per service you reach directly. Remember Docker-published ports
are not filtered by ufw; use the bind-address approach above for those.

**`listening on all interfaces`** (list)

Anything in that list you don't recognise is worth a `sudo ss -tulnp` to
see which process owns it.

## Samba

**`guest access is enabled`**

Set `guest ok = no` on the share and `map to guest = never` in `[global]`,
then `sudo systemctl reload smbd`. The Windows PC and Mac should connect
with a Samba user (`sudo smbpasswd -a <your-user>`).

**`server min protocol is unset`**

In `[global]`: `server min protocol = SMB2`. SMB1 has no business on a
2026 network. Windows 10+ and macOS both speak SMB3.

**`testparm reports problems`**

`testparm -s` prints the offending line. Fix it in `/etc/samba/smb.conf`
(backup first), re-run testparm, reload.

## Backups

**`no backup timer or cron job found`**

What needs protecting is small: compose files, `.env` files, Home
Assistant config, Samba config, and the vault (already in git). The
`backup/` folder in this repo has the complete answer: a restic
repository in Google Drive via the same `gdrive:` rclone remote, a nightly
user timer, retention, and the restore test. Follow `backup/README.md`.

Do this **before** the fstab, memory and SSH changes above, so every one
of them is made on a box that can be put back.

A backup nobody has restored from is a hope, not a backup. The README's
restore test is not optional.

## Secrets

**`lines in .bash_history look like they contain a key`**

1. Rotate the key at the provider first (OpenRouter, Anthropic, GitHub).
2. Then remove the lines: `history -d <n>` for the current session, or
   edit `~/.bash_history` directly and `history -c; history -r`.
3. Stop the recurrence: `export HISTCONTROL=ignorespace` in `~/.bashrc`,
   and type secrets into `nano .env`, never on the command line.

**`literal API key in docker-compose*.yml`**

Move it to `.env` (`OPENROUTER_API_KEY=...`) and reference it as
`${OPENROUTER_API_KEY}` in the compose file. Rotate the key; it has been
sitting in a file that may be in git history or a backup.

**`.env is mode 644`**

`chmod 600 ~/ai-stack/.env`. Compose reads it as your user; nothing else
needs to.

**`~/ai-stack/.env is tracked by git`**

`git rm --cached .env`, add `.env` to `.gitignore`, rotate every key in it,
and treat the history as compromised if the repo was ever pushed.

**`rclone.conf is mode 644`**

`chmod 600 ~/.config/rclone/rclone.conf`. It holds the Drive OAuth token.

## Disk

**`/ is 9x% full`**

Usual suspects on this box, in order: `docker system df` (images, build
cache), `journalctl --disk-usage` (cap with `SystemMaxUse=500M` in
`/etc/systemd/journald.conf`), qBittorrent's download directory, Jellyfin
transcode cache.

**`SMART not PASSED`**

Back up now, replace the drive soon. `sudo smartctl -a /dev/sdX` shows
which attribute tripped.
