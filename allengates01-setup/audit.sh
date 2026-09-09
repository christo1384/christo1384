#!/usr/bin/env bash
# Phase 0 audit for allengates01 — READ-ONLY.
#
# Run this on the box itself, in a terminal, before applying anything from
# this folder:
#     bash ~/path/to/allengates01-setup/audit.sh
#
# It prints what is already installed and what already exists so the
# drafts here can be compared against reality. It changes nothing.

# shellcheck disable=SC2088  # tildes below are display text, not paths
set -u

hr() { printf '\n== %s ==\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
show_ver() {
    if have "$1"; then
        printf '%-10s %s\n' "$1" "$("$@" 2>&1 | head -n 1)"
    else
        printf '%-10s NOT INSTALLED\n' "$1"
    fi
}

hr "Machine"
printf 'host:      %s\n' "$(hostname)"
printf 'user:      %s\n' "$(id -un)"
if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    printf 'os:        %s\n' "${PRETTY_NAME:-unknown}"
fi
printf 'kernel:    %s\n' "$(uname -r)"
printf 'mem:       %s\n' "$(free -h | awk '/^Mem:/{print $2 " total, " $7 " available"}')"
printf 'swap:      %s\n' "$(free -h | awk '/^Swap:/{print $3 " used of " $2}')"
printf 'disk ~:    %s\n' "$(df -h "$HOME" | awk 'NR==2{print $4 " free of " $2}')"

hr "Tooling"
show_ver claude --version
show_ver node --version
show_ver npm --version
show_ver git --version
show_ver gh --version
show_ver python3 --version
show_ver rclone version
show_ver docker --version
if have claude; then
    printf 'claude at: %s\n' "$(command -v claude)"
    if command -v claude | grep -q node_modules; then
        echo "install:   npm (global node_modules)"
    else
        echo "install:   native binary or other (not under node_modules)"
    fi
fi

hr "Existing Claude Code config (~/.claude)"
if [ -d "$HOME/.claude" ]; then
    for f in CLAUDE.md settings.json settings.local.json; do
        if [ -L "$HOME/.claude/$f" ]; then
            printf '%-20s SYMLINK -> %s  (Cowork will skip a symlinked CLAUDE.md)\n' "$f" "$(readlink "$HOME/.claude/$f")"
        elif [ -e "$HOME/.claude/$f" ]; then
            printf '%-20s present (%s lines)\n' "$f" "$(wc -l < "$HOME/.claude/$f")"
        else
            printf '%-20s absent\n' "$f"
        fi
    done
    if [ -d "$HOME/.claude/rules" ]; then
        echo "rules/:"
        find "$HOME/.claude/rules" -maxdepth 1 -name '*.md' -printf '  %f\n' 2>/dev/null
    else
        echo "rules/               absent"
    fi
    for d in skills plugins projects; do
        [ -d "$HOME/.claude/$d" ] && printf '%-20s %s entries\n' "$d/" "$(find "$HOME/.claude/$d" -mindepth 1 -maxdepth 1 | wc -l)"
    done
else
    echo "~/.claude does not exist — Claude Code has not been run as this user."
fi
if [ -f "$HOME/.claude.json" ]; then
    echo "~/.claude.json       present (MCP servers / OAuth state live here)"
    if have python3; then
        python3 - <<'PY' 2>/dev/null || true
import json, os
p = os.path.expanduser("~/.claude.json")
try:
    d = json.load(open(p))
    mcp = d.get("mcpServers", {})
    print("  user-scope MCP servers:", ", ".join(mcp) if mcp else "none")
except Exception as e:
    print("  (could not parse:", e, ")")
PY
    fi
fi

hr "Project layout (~/claude)"
if [ -d "$HOME/claude" ]; then
    find "$HOME/claude" -maxdepth 2 -mindepth 1 -type d -not -path '*/.*' | sed "s|$HOME/||" | sort
    [ -f "$HOME/claude/MANIFEST.md" ] && echo "MANIFEST.md present" || echo "MANIFEST.md absent"
else
    echo "~/claude does not exist."
fi

hr "Claude Desktop / Cowork"
if [ -d "$HOME/.config/Claude" ]; then
    echo "~/.config/Claude present (Claude Desktop has run)"
else
    echo "~/.config/Claude absent (Claude Desktop not detected for this user)"
fi

hr "rclone"
if have rclone; then
    remotes="$(rclone listremotes 2>/dev/null)"
    if [ -n "$remotes" ]; then
        echo "remotes:"; printf '%s\n' "$remotes" | sed 's/^/  /'
    else
        echo "no remotes configured"
    fi
    echo "user timers mentioning rclone/brain:"
    systemctl --user list-timers --all 2>/dev/null | grep -iE 'rclone|brain' || echo "  none"
fi

hr "Known separate jobs (not touched by this setup)"
if have findmnt; then
    if findmnt --verify >/dev/null 2>&1; then
        echo "fstab:     parses clean"
    else
        echo "fstab:     findmnt --verify reports problems (known separate job)"
    fi
fi

hr "Docker (n8n / ai-stack, from vault deployment record)"
if have docker && docker info >/dev/null 2>&1; then
    docker ps --format '  {{.Names}}\t{{.Status}}' | grep -E 'n8n|sandbox|ollama' || echo "  no n8n/sandbox/ollama containers running"
else
    echo "  docker not available to this user (or daemon not running)"
fi

echo
echo "Audit complete. Nothing was changed."
