# Running it on the home box

Phase 2 is meant to live on a Linux machine at home and be used from a phone
on the same wifi. This is the whole setup.

**If the box and the phone are both on Tailscale, use that** — skip to
[Serving it over Tailscale](#serving-it-over-tailscale). It is strictly better
than the LAN setup below: real HTTPS with a valid certificate, no firewall
rules, nothing listening outside the machine, and it keeps working from a job
site instead of only at home.

The LAN setup in steps 2-6 is the fallback when there is no Tailscale. It serves
plain HTTP, so passwords and receipts cross the wifi unencrypted — a reasonable
trade on a household network, **not** reasonable on public wifi, and never to be
port-forwarded to the internet.

---

## 1. Install it

Needs **Node 22.5 or newer** (`node -v`). On Debian or Ubuntu:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Then put the app somewhere permanent and give it **its own** user:

```sh
sudo useradd --system --home /opt/contracting-ops --shell /usr/sbin/nologin contracting-ops
sudo git clone <your-repo-url> /opt/contracting-ops
sudo chown -R contracting-ops:contracting-ops /opt/contracting-ops
```

The dedicated account matters more than it looks. If another service on this box
runs as the same user, that service — and anything that compromises it — can read
`data/ops.db`: the books, the client list and the password hashes. Do not reuse a
generic `ops` account that something else already uses. See [Sharing the box with
another app](#sharing-the-box-with-another-app).

There are no dependencies to install. Nothing to build.

## 2. Start it as a service

```sh
sudo cp /opt/contracting-ops/deploy/contracting-ops.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now contracting-ops
systemctl status contracting-ops
```

It binds `0.0.0.0:4000` so the phone can reach it. The unit runs the app as the
`contracting-ops` user with a read-only filesystem apart from `data/` and
`backups/`.

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
sudo -u contracting-ops npm --prefix /opt/contracting-ops run user:add -- --username mike --name "Mike"
```

Add the second person from **Account → Add another person** in the app, or with
the same command. Forgotten password:

```sh
sudo -u contracting-ops npm --prefix /opt/contracting-ops run user:passwd -- --username mike
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

If he needs it from the road, the answer is Tailscale, not a port forward — see
[Serving it over Tailscale](#serving-it-over-tailscale). Nothing is exposed, and
the same URL works from anywhere.

## Sharing the box with another app

If this box already runs something else, three things have to be kept apart.

**1. A separate user account.** Not a shared `ops`. The app stores financial
records; the database and the uploaded receipts are written owner-only (`0600`
inside a `0700` directory) and a dedicated account is what makes that mean
anything. Check what a neighbouring service runs as before you pick a name:

```sh
systemctl show <other-service> -p User
```

**2. A separate port.** The default is 4000; `PORT=4010` in the unit moves it.
Check what is already taken:

```sh
sudo ss -lntp | grep LISTEN
```

**3. A separate Tailscale entry — and this is the one that bites.** Serve and
Funnel share a single config on the machine. Whichever app was configured last
owns the path it claimed, and if the other app used `tailscale funnel`, it owns
the public hostname on port 443.

Serve and Funnel allow only three HTTPS ports: **443, 8443 and 10000**. So if
something else already holds 443, put this app on another one:

```sh
sudo tailscale serve --bg --https=8443 4000
tailscale serve status
tailscale funnel status
```

That gives `https://<machine>.<tailnet>.ts.net:8443`, private to the tailnet,
alongside whatever holds 443.

**Check `tailscale funnel status` afterwards and make sure this app's port is not
listed.** Funnel publishes to the open internet. A neighbouring app may
legitimately be funnelled; this one must not be.

Do not try `--set-path /ops` instead. The app loads `/styles.css`, `/app.js` and
`/icon-180.png` as root-absolute paths, so under a sub-path the browser asks the
domain root for them and gets the other app's 404s — an unstyled page with no
JavaScript. A separate port needs no code change; a sub-path would need a base
path threaded through the shell and the fetch wrapper.

## Serving it over Tailscale

This is the setup to use. Tailscale gives the box a stable name, issues it a
real certificate, and proxies to the app over the loopback address — so nothing
is listening on the LAN at all, and the phone gets a plain `https://` URL with
no warnings.

### 1. Both devices on the tailnet

Install Tailscale on the box and sign in:

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale status          # the box and the iPhone should both be listed
```

The iPhone needs the Tailscale app from the App Store, signed into the same
account, with the VPN toggle on.

### 2. Turn on MagicDNS and HTTPS certificates

Both live in the admin console under
[**DNS**](https://login.tailscale.com/admin/dns):

- **MagicDNS** — on.
- **HTTPS Certificates** — enable.

This is what gives the box a name like `boxname.tailnet-name.ts.net` and lets it
fetch a real Let's Encrypt certificate for it. Without this step you get an IP
address and a certificate warning.

### 3. Point the app at the loopback address

Edit the systemd unit so the app is *only* reachable from the machine itself,
and knows its cookies will travel over HTTPS:

```
Environment=HOST=127.0.0.1
Environment=COOKIE_SECURE=1
```

```sh
sudo systemctl daemon-reload
sudo systemctl restart contracting-ops
journalctl -u contracting-ops -n 10
#   Contracting Ops (phase 4) listening on 127.0.0.1:4000
#   this machine only - reach it from a phone through a proxy
```

`COOKIE_SECURE=1` matters: Tailscale terminates the TLS and forwards plain HTTP
to the app, so the app cannot tell the connection was encrypted. This tells it.

### 4. Put Tailscale in front

```sh
sudo tailscale serve --bg 4000
tailscale serve status
```

That prints the URL to use:

```
https://boxname.tailnet-name.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:4000
```

On older Tailscale (before 1.60) the equivalent is
`sudo tailscale serve https / http://127.0.0.1:4000`.

`--bg` persists across reboots. `tailscale serve reset` clears it.

**Never use `tailscale funnel`.** Serve keeps this on your tailnet; Funnel
publishes it to the open internet, which is exactly what this app is not built
for.

### 5. On the iPhone

Open the `https://boxname.tailnet-name.ts.net` URL in **Safari** — no port, no
warning, valid padlock. Then Share → **Add to Home Screen**.

It now works on home wifi *and* on cellular from a job site, because the phone
reaches the box over the tailnet either way.

### What this changes

| | LAN setup | Tailscale Serve |
| --- | --- | --- |
| Encryption | none | real certificate, no warnings |
| Listening on the LAN | port 4000 | nothing |
| Firewall rule needed | yes | no |
| Works away from home | no | yes |
| Session cookies | not `Secure` | `Secure` |

The firewall rule from step 4 of the LAN setup can be removed once Serve is
working — nothing is listening there any more:

```sh
sudo ufw delete allow from 192.168.1.0/24 to any port 4000 proto tcp
```

**Tailscale is not a substitute for the app's own login.** Anyone on your tailnet
can reach the URL; the password is what stops them reading the books. Keep both.

## Optional: HTTPS without Tailscale

If you are on the LAN setup and want encryption anyway, point the server at a
self-signed certificate:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /opt/contracting-ops/data/key.pem \
  -out /opt/contracting-ops/data/cert.pem \
  -subj "/CN=192.168.1.42" -addext "subjectAltName=IP:192.168.1.42"
```

```
Environment=TLS_CERT=/opt/contracting-ops/data/cert.pem
Environment=TLS_KEY=/opt/contracting-ops/data/key.pem
```

Session cookies are marked `Secure` automatically once TLS is on. iOS will warn
about the self-signed certificate every time unless you install and trust it
(Settings → General → VPN & Device Management, then Certificate Trust Settings).
Tailscale avoids this entirely, which is why it is the recommended path.

## Day-to-day

| Task | Command |
| ---- | ------- |
| Restart | `sudo systemctl restart contracting-ops` |
| Logs | `journalctl -u contracting-ops -f` |
| Back up now | `sudo -u contracting-ops /opt/contracting-ops/bin/backup.sh` |
| List accounts | `sudo -u contracting-ops npm --prefix /opt/contracting-ops run user:list` |
| Update | `sudo -u contracting-ops git -C /opt/contracting-ops pull && sudo systemctl restart contracting-ops` |

Migrations run automatically at startup, so an update never needs a manual
database step. Take a backup before pulling anyway.

## If something breaks

| Symptom | Check |
| ------- | ----- |
| Phone cannot reach it (Tailscale) | `tailscale status` on both. `tailscale serve status` on the box. `curl localhost:4000/api/health` on the box. |
| Certificate warning on the phone | HTTPS Certificates not enabled in the admin console, or you opened the `100.x` address instead of the `.ts.net` name. |
| Signed out on every page (Tailscale) | `COOKIE_SECURE=1` set but Serve not actually terminating TLS, or the reverse. Check `tailscale serve status`. |
| Another app answers at the tailnet URL | Serve/Funnel config is shared per machine and the other app claimed 443. Put this one on 8443 — see [Sharing the box](#sharing-the-box-with-another-app). |
| Phone cannot reach it (LAN) | Same wifi? `sudo ufw status`. `curl localhost:4000/api/health` on the box. |
| "Set up" screen reappeared | The database moved or was replaced. `npm run user:list` shows what the app can see. |
| Receipt upload fails | Over 12 MB, or a file type that is not JPEG/PNG/HEIC/WebP/PDF. |
| Service will not start | `journalctl -u contracting-ops -n 50`. Usually Node older than 22.5, or `data/` not writable by `ops`. |
| Locked out after bad passwords | Eight failures locks that name for 15 minutes. Wait, or reset with `user:passwd`. |
