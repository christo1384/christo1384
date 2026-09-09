#!/usr/bin/env bash
# System-standard audit for allengates01 — READ-ONLY.
#
# Companion to audit.sh (which covers the Claude Code setup). This one
# covers the box itself: patch state, boot safety, memory budget, SSH and
# firewall exposure, backups, and secrets hygiene. Run it on the box:
#     bash allengates01-setup/system-audit.sh
#
# Some checks need root to see everything (sshd config, ufw status, docker
# stats, journal). Run it once as your own user, then once with sudo, and
# compare. It changes nothing either way.

set -u

hr()   { printf '\n== %s ==\n' "$1"; }
ok()   { printf '  [ok]   %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }
info() { printf '  [info] %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
is_root() { [ "$(id -u)" -eq 0 ]; }

hr "Patch state"
if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    info "os: ${PRETTY_NAME:-unknown}"
fi
if have apt-get; then
    # -s simulates; touches nothing. Needs a recent 'apt update' to be accurate.
    upgradable="$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst ' || true)"
    security="$(apt-get -s upgrade 2>/dev/null | grep '^Inst ' | grep -ci 'security' || true)"
    last_update="$(stat -c %y /var/lib/apt/lists 2>/dev/null | cut -d. -f1)"
    info "apt lists last refreshed: ${last_update:-unknown}"
    if [ "${upgradable:-0}" -eq 0 ]; then
        ok "no pending upgrades (per last apt update)"
    else
        warn "$upgradable packages upgradable, $security from security suites"
    fi
fi
if [ -f /var/run/reboot-required ]; then
    warn "reboot required: $(tr '\n' ' ' < /var/run/reboot-required.pkgs 2>/dev/null)"
else
    ok "no reboot pending"
fi
if dpkg -s unattended-upgrades >/dev/null 2>&1; then
    if grep -qsE '^APT::Periodic::Unattended-Upgrade "1";' /etc/apt/apt.conf.d/20auto-upgrades; then
        ok "unattended-upgrades installed and enabled"
    else
        warn "unattended-upgrades installed but not enabled in 20auto-upgrades"
    fi
else
    warn "unattended-upgrades not installed"
fi
info "uptime: $(uptime -p 2>/dev/null || uptime)"

hr "Boot safety (fstab)"
if have findmnt; then
    if findmnt --verify >/dev/null 2>&1; then
        ok "fstab parses clean"
    else
        warn "findmnt --verify reports problems:"
        findmnt --verify 2>&1 | sed 's/^/         /' | head -n 20
    fi
fi
if grep -qsE '^[^#].*\b(cifs|smb|nfs)\b' /etc/fstab; then
    info "network mounts in fstab:"
    grep -E '^[^#].*\b(cifs|smb|nfs)\b' /etc/fstab | sed 's/^/         /'
    if grep -E '^[^#].*\b(cifs|smb|nfs)\b' /etc/fstab | grep -qvE 'nofail|_netdev|x-systemd.automount'; then
        warn "a network mount lacks nofail/_netdev — boot can hang if the share is down"
    fi
fi
if grep -qsE '^[^#].*(password|pass)=' /etc/fstab; then
    warn "credentials appear inline in /etc/fstab — move them to a credentials= file with mode 600"
fi

hr "Memory budget"
free -h | sed 's/^/  /'
swap_used_kb="$(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{print t-f}' /proc/meminfo)"
mem_total_kb="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
if [ "${swap_used_kb:-0}" -gt $((mem_total_kb / 4)) ]; then
    warn "swap in use exceeds a quarter of RAM — the box is running on swap, not RAM"
else
    ok "swap use is within a quarter of RAM"
fi
info "swappiness: $(cat /proc/sys/vm/swappiness)"
if have journalctl; then
    if is_root || id -nG | grep -qwE 'systemd-journal|adm'; then
        oom="$(journalctl -k --since '30 days ago' 2>/dev/null | grep -ci 'out of memory\|oom-kill' || true)"
        if [ "${oom:-0}" -gt 0 ]; then
            warn "$oom OOM-killer events in the kernel log in the last 30 days"
            journalctl -k --since '30 days ago' 2>/dev/null | grep -i 'killed process' | tail -n 5 | sed 's/^/         /'
        else
            ok "no OOM-killer events in the last 30 days"
        fi
    else
        info "kernel journal not readable as this user — re-run with sudo for OOM history"
    fi
fi
echo "  top memory consumers:"
ps -eo rss,comm --sort=-rss 2>/dev/null | head -n 8 | awk 'NR>1{printf "         %6d MB  %s\n", $1/1024, $2}'

hr "Docker"
if have docker && docker info >/dev/null 2>&1; then
    info "$(docker --version)"
    echo "  containers, memory limit, restart policy:"
    docker ps -q 2>/dev/null | while read -r id; do
        docker inspect --format '{{.Name}} {{.HostConfig.Memory}} {{.HostConfig.RestartPolicy.Name}} {{.HostConfig.Privileged}}' "$id"
    done | awk '{
        name=substr($1,2); lim=($2==0)?"NO LIMIT":sprintf("%dM",$2/1048576);
        priv=($4=="true")?" PRIVILEGED":"";
        flag=($2==0)?"  [WARN] ":"  [ok]   ";
        printf "%s%-22s %-10s restart=%s%s\n", flag, name, lim, $3, priv
    }'
    echo "  live usage:"
    docker stats --no-stream --format '         {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' 2>/dev/null
    echo "  published ports:"
    docker ps --format '         {{.Names}}\t{{.Ports}}' 2>/dev/null | grep -v '\t$' || echo "         none"
    if docker ps --format '{{.Ports}}' 2>/dev/null | grep -q '0.0.0.0:'; then
        warn "containers publish on 0.0.0.0 — they are reachable from the whole LAN, and docker bypasses ufw for published ports"
    fi
    dangling="$(docker images -f dangling=true -q 2>/dev/null | wc -l)"
    [ "$dangling" -gt 0 ] && info "$dangling dangling images (docker image prune would reclaim them)"
    info "disk: $(docker system df --format '{{.Type}} {{.Size}} ({{.Reclaimable}} reclaimable)' 2>/dev/null | tr '\n' '; ')"
else
    info "docker not available to this user or not running — re-run with sudo"
fi

hr "SSH exposure"
if have sshd || [ -f /etc/ssh/sshd_config ]; then
    if is_root && have sshd; then
        eff="$(sshd -T 2>/dev/null)"
        pa="$(printf '%s\n' "$eff" | awk '$1=="passwordauthentication"{print $2}')"
        prl="$(printf '%s\n' "$eff" | awk '$1=="permitrootlogin"{print $2}')"
        port="$(printf '%s\n' "$eff" | awk '$1=="port"{print $2}' | tr '\n' ' ')"
        [ "$pa" = "no" ] && ok "password authentication off" || warn "password authentication is ${pa:-on (default)}"
        [ "$prl" = "no" ] && ok "root login off" || warn "PermitRootLogin is ${prl:-default}"
        info "listening on port(s): ${port:-22}"
    else
        info "effective sshd config needs root — re-run with sudo. Static file says:"
        grep -hsE '^\s*(PasswordAuthentication|PermitRootLogin|Port)\b' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | sed 's/^/         /' || echo "         (defaults: password auth ON, root login prohibit-password)"
    fi
    if [ -f "$HOME/.ssh/authorized_keys" ]; then
        info "$(grep -cE '^(ssh|ecdsa)-' "$HOME/.ssh/authorized_keys") authorized key(s) for $(id -un)"
    else
        warn "no ~/.ssh/authorized_keys for $(id -un) — turning password auth off would lock you out"
    fi
    if have fail2ban-client; then ok "fail2ban installed"; else info "fail2ban not installed (fine on a LAN-only box)"; fi
else
    info "sshd not present"
fi

hr "Firewall and listening services"
if have ufw; then
    if is_root; then
        ufw status verbose 2>/dev/null | sed 's/^/  /' | head -n 25
    else
        info "ufw status needs root — re-run with sudo"
    fi
elif have nft; then
    info "nftables present, ufw not installed"
    is_root && nft list ruleset 2>/dev/null | head -n 30 | sed 's/^/  /'
else
    warn "no ufw or nftables found — nothing filters inbound traffic on this host"
fi
if have ss; then
    echo "  listening on all interfaces (0.0.0.0 / [::]):"
    ss -tulnH 2>/dev/null | awk '$5 ~ /^(0\.0\.0\.0|\[::\]|\*):/ {print "         " $1 "\t" $5}' | sort -u
fi

hr "Samba"
if have smbd || [ -f /etc/samba/smb.conf ]; then
    if have testparm; then
        if testparm -s /etc/samba/smb.conf >/dev/null 2>&1; then
            ok "smb.conf parses clean"
        else
            warn "testparm reports problems in smb.conf"
        fi
        shares="$(testparm -s 2>/dev/null | grep -E '^\[' | grep -vE '^\[(global|printers|print\$)\]' | tr '\n' ' ')"
        info "shares: ${shares:-none}"
        if testparm -s 2>/dev/null | grep -qiE 'guest ok = yes|map to guest = bad user'; then
            warn "guest access is enabled on at least one share"
        fi
        proto="$(testparm -s -v 2>/dev/null | awk -F= '/server min protocol/{gsub(/ /,"",$2);print $2}')"
        case "$proto" in
            SMB2*|SMB3*) ok "server min protocol $proto" ;;
            *) warn "server min protocol is ${proto:-unset} — SMB1 may be accepted" ;;
        esac
    fi
else
    info "samba not present"
fi

hr "Backups"
found=0
for unit in $(systemctl list-timers --all --no-legend 2>/dev/null | awk '{print $NF}'; systemctl --user list-timers --all --no-legend 2>/dev/null | awk '{print $NF}'); do
    case "$unit" in *backup*|*restic*|*borg*|*rclone*|*rsync*|*snapshot*) info "timer: $unit"; found=1 ;; esac
done
if crontab -l 2>/dev/null | grep -qiE 'backup|restic|borg|rclone|rsync'; then
    info "cron entries mention backup tooling:"; crontab -l 2>/dev/null | grep -iE 'backup|restic|borg|rclone|rsync' | sed 's/^/         /'; found=1
fi
for tool in restic borg rclone rsnapshot duplicati; do have "$tool" && info "$tool installed"; done
[ "$found" -eq 0 ] && warn "no backup timer or cron job found — compose files, .env files and Home Assistant config are unprotected"
for d in "$HOME/ai-stack" "$HOME/homeassistant" "$HOME/.homeassistant" /opt/homeassistant /srv; do
    [ -d "$d" ] && info "config dir present: $d ($(du -sh "$d" 2>/dev/null | cut -f1))"
done
if have rclone; then
    r="$(rclone listremotes 2>/dev/null | tr '\n' ' ')"
    info "rclone remotes: ${r:-none}"
fi

hr "Secrets hygiene"
for h in "$HOME/.bash_history" "$HOME/.zsh_history"; do
    if [ -f "$h" ]; then
        n="$(grep -cE 'sk-or-|sk-ant-|ghp_|github_pat_|AKIA[0-9A-Z]{12}|xox[bp]-|API_KEY=|TOKEN=|PASSWORD=' "$h" 2>/dev/null || true)"
        if [ "${n:-0}" -gt 0 ]; then
            warn "$n line(s) in $(basename "$h") look like they contain a key or password — review, rotate, then clear those lines"
        else
            ok "no obvious secrets in $(basename "$h")"
        fi
    fi
done
for c in "$HOME"/ai-stack/docker-compose*.yml "$HOME"/*/docker-compose*.yml; do
    [ -f "$c" ] || continue
    if grep -qE '(sk-or-|sk-ant-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}' "$c"; then
        warn "literal API key in $c — move it to .env"
    else
        ok "no literal API keys in $c"
    fi
done
for e in "$HOME"/ai-stack/.env "$HOME"/*/.env; do
    [ -f "$e" ] || continue
    mode="$(stat -c %a "$e")"
    [ "$mode" = "600" ] && ok "$e is mode 600" || warn "$e is mode $mode — should be 600"
done
if [ -d "$HOME/ai-stack/.git" ] && git -C "$HOME/ai-stack" ls-files --error-unmatch .env >/dev/null 2>&1; then
    warn "~/ai-stack/.env is tracked by git"
fi
if [ -d "$HOME/.config/rclone" ]; then
    mode="$(stat -c %a "$HOME/.config/rclone/rclone.conf" 2>/dev/null)"
    [ "$mode" = "600" ] && ok "rclone.conf is mode 600" || warn "rclone.conf is mode ${mode:-missing}"
fi
sudoers_nopw="$(sudo -n -l 2>/dev/null | grep -c NOPASSWD || true)"
[ "${sudoers_nopw:-0}" -gt 0 ] && info "this user has NOPASSWD sudo entries" || true

hr "Disk"
df -h --output=target,size,avail,pcent -x tmpfs -x devtmpfs -x overlay 2>/dev/null | sed 's/^/  /'
df --output=pcent,target -x tmpfs -x devtmpfs -x overlay 2>/dev/null | awk 'NR>1 && $1+0 > 85 {print "  [WARN] " $2 " is " $1 " full"}'
if have smartctl && is_root; then
    for d in /dev/sd? /dev/nvme?n1; do
        [ -e "$d" ] || continue
        smartctl -H "$d" 2>/dev/null | grep -q PASSED && ok "SMART $d PASSED" || warn "SMART $d not PASSED or unreadable"
    done
fi

echo
echo "Audit complete. Nothing was changed."
echo "Lines marked [WARN] are the to-do list for the system-standard session."
