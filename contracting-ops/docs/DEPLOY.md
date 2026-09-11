# Running it on the home box

Phase 2 is meant to live on a Linux machine at home and be used from a phone
on the same wifi. This is the whole setup.

**Read this first:** the app has a login, but on a home network it serves plain
HTTP, so passwords and receipts cross the wifi unencrypted. That is a reasonable
trade for a household LAN. It is **not** reasonable on public wifi, and this
should never be port-forwarded to the internet. See [Do not expose
it](#do-not-expose-it-to-the-internet) and [HTTPS](#optional-https-on-the-lan).

---

## 1. Install it

Needs **Node 22.5 or newer** (`node -v`). On Debian or Ubuntu:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Then put the app somewhere permanent and give it its own user:

```sh
sudo useradd --system --home /opt/contracting-ops --shell /usr/sbin/nologin ops
sudo git clone <your-repo-url> /opt/contracting-ops
sudo chown -R ops:ops /opt/contracting-ops
```

There are no dependencies to install. Nothing to build.

## 2. Start it as a service

```sh
sudo cp /opt/contracting-ops/deploy/contracting-ops.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now contracting-ops
systemctl status contracting-ops
```

It binds `0.0.0.0:4000` so the phone can reach it. The unit runs the app as the
`ops` user with a read-only filesystem apart from `data/` and `backups/`.

Check it printed your LAN address:

```sh
journalctl -u contracting-ops -n 20
#   this box:   http://localhost:4000
#   your phone: http://192.168.1.42:4000
```

## 3. Give the box a fixed address

The phone needs an address that does not change. Either:

- **Router DHCP reservation** (easiest) — find the box's MAC in your router's
  admin page and reserve its current IP. Nothing to configure on the box.
- **Static IP on the box** via NetworkManager:
  ```sh
  nmcli con mod "Wired connection 1" ipv4.method manual \
    ipv4.addresses 192.168.1.42/24 ipv4.gateway 192.168.1.1 ipv4.dns 192.168.1.1
  sudo systemctl restart NetworkManager
  ```

If the box runs Avahi (`sudo apt install avahi-daemon`), `http://boxname.local:4000`
works from iPhones too and survives an address change.

## 4. Open the port to the LAN only

With ufw:

```sh
sudo ufw allow from 192.168.1.0/24 to any port 4000 proto tcp
sudo ufw enable
```

The `from 192.168.1.0/24` is the important half — it allows your own network and
nothing else. Use your actual subnet.

## 5. Create the first account

Open `http://192.168.1.42:4000` from any device on the network. Because nobody
has an account yet, the first screen is **Set up Contracting Ops**. Fill it in;
that screen closes permanently once one account exists.

Or from the box's terminal:

```sh
sudo -u ops npm --prefix /opt/contracting-ops run user:add -- --username mike --name "Mike"
```

Add the second person from **Account → Add another person** in the app, or with
the same command. Forgotten password:

```sh
sudo -u ops npm --prefix /opt/contracting-ops run user:passwd -- --username mike
```

That also signs that person out everywhere.

## 6. Put it on the iPhone home screen

1. Open `http://192.168.1.42:4000` in **Safari** (not Chrome — only Safari can
   install a home-screen app on iOS).
2. Share button → **Add to Home Screen** → Add.
3. It opens full screen with no browser chrome, like an app.

Sessions last 30 days, so it will not ask him to sign in every morning.

**Adding a receipt from a job site:** Money → Add expense → tap *Receipt photo* →
Take Photo. The photo is shrunk in the browser before it is sent, so a 4 MB
iPhone photo uploads as roughly 300 KB. It only works on wifi at home — the box
is not reachable from the road. Logging the expense without the photo and
attaching it later that evening works fine.

## 7. Turn on backups

```sh
sudo cp /opt/contracting-ops/deploy/contracting-ops-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now contracting-ops-backup.timer
systemctl list-timers contracting-ops-backup
```

Nightly at 02:30 it writes a consistent snapshot (`ops-<timestamp>.db`) plus a
tarball of the receipts into `backups/`, keeping 30 days.

**Backups on the same disk are not backups.** Copy them off the box — an
external drive, a NAS, or another machine:

```sh
# in root's crontab, after the nightly snapshot
30 3 * * * rsync -a /opt/contracting-ops/backups/ /mnt/usb/contracting-ops/
```

To restore, stop the service, copy a snapshot over `data/ops.db`, untar the
receipts into `data/uploads/`, start it again.

---

## Do not expose it to the internet

No port forwarding, no `0.0.0.0` on a public interface, no putting it behind a
dynamic-DNS name. It is a small app holding real financial records and there is
no reason to invite the whole internet to try passwords against it.

If he genuinely needs it from the road, the right answer is a VPN into the home
network — [Tailscale](https://tailscale.com) takes about ten minutes and gives
the phone an address on the home network from anywhere, with nothing exposed.
Then the same `http://192.168.1.42:4000` works away from home.

## Optional: HTTPS on the LAN

Plain HTTP on a home network is a defensible trade-off. If you would rather
encrypt it anyway, point the server at a certificate:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /opt/contracting-ops/data/key.pem \
  -out /opt/contracting-ops/data/cert.pem \
  -subj "/CN=192.168.1.42" -addext "subjectAltName=IP:192.168.1.42"
```

Add to the systemd unit:

```
Environment=TLS_CERT=/opt/contracting-ops/data/cert.pem
Environment=TLS_KEY=/opt/contracting-ops/data/key.pem
```

Session cookies are marked `Secure` automatically once TLS is on. iOS will warn
about the self-signed certificate every time unless you install and trust it
(Settings → General → VPN & Device Management, then Certificate Trust Settings).
A Tailscale address with its automatic certificate avoids that dance entirely.

## Day-to-day

| Task | Command |
| ---- | ------- |
| Restart | `sudo systemctl restart contracting-ops` |
| Logs | `journalctl -u contracting-ops -f` |
| Back up now | `sudo -u ops /opt/contracting-ops/bin/backup.sh` |
| List accounts | `sudo -u ops npm --prefix /opt/contracting-ops run user:list` |
| Update | `sudo -u ops git -C /opt/contracting-ops pull && sudo systemctl restart contracting-ops` |

Migrations run automatically at startup, so an update never needs a manual
database step. Take a backup before pulling anyway.

## If something breaks

| Symptom | Check |
| ------- | ----- |
| Phone cannot reach it | Same wifi? `sudo ufw status`. `curl localhost:4000/api/health` on the box. |
| "Set up" screen reappeared | The database moved or was replaced. `npm run user:list` shows what the app can see. |
| Receipt upload fails | Over 12 MB, or a file type that is not JPEG/PNG/HEIC/WebP/PDF. |
| Service will not start | `journalctl -u contracting-ops -n 50`. Usually Node older than 22.5, or `data/` not writable by `ops`. |
| Locked out after bad passwords | Eight failures locks that name for 15 minutes. Wait, or reset with `user:passwd`. |
