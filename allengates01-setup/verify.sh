#!/usr/bin/env bash
# Phase 9 verification for allengates01 — READ-ONLY.
#
# Run after apply.sh (and, optionally, after the Brain Hub timer install):
#     bash verify.sh
#
# Prints PASS/FAIL per check and exits non-zero if anything failed, so it
# can be re-run until clean. Changes nothing.

# shellcheck disable=SC2088  # tildes in messages are display text
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="$HOME/.claude"
PROJ_ROOT="$HOME/claude"
fails=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
skip() { printf '  skip  %s\n' "$1"; }
hr()   { printf '\n== %s ==\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

hr "Claude Code binary"
if have claude; then
    pass "claude on PATH: $(claude --version 2>&1 | head -n 1)"
    if [ -x "$HOME/.claude/local/claude" ] || ! command -v claude | grep -q node_modules; then
        pass "native install (not npm global)"
    else
        fail "claude resolves under node_modules — the plan calls for the native install"
    fi
else
    fail "claude not on PATH"
fi

hr "~/.claude global config"
for f in CLAUDE.md settings.json; do
    p="$CLAUDE_HOME/$f"
    if [ -L "$p" ]; then
        fail "$f is a symlink (Cowork skips it) — apply.sh replaces it with a real file"
    elif [ -f "$p" ]; then
        if cmp -s "$p" "$HERE/claude-global/$f"; then
            pass "$f present and matches the draft"
        else
            pass "$f present (differs from draft — fine if edited on purpose)"
        fi
    else
        fail "$f missing"
    fi
done
if have python3 && [ -f "$CLAUDE_HOME/settings.json" ]; then
    if python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$CLAUDE_HOME/settings.json" 2>/dev/null; then
        pass "settings.json is valid JSON"
    else
        fail "settings.json is not valid JSON — Claude Code will ignore it"
    fi
    if python3 - "$CLAUDE_HOME/settings.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
deny = d.get("permissions", {}).get("deny", [])
sys.exit(0 if any(r.startswith("Bash(rm -r") for r in deny) else 1)
PY
    then pass "recursive rm is denied in settings.json"
    else fail "no Bash(rm -r*) deny rule in settings.json"
    fi
fi
for r in machine.md nz-context.md safety.md workflows.md; do
    if [ -f "$CLAUDE_HOME/rules/$r" ]; then pass "rules/$r present"; else fail "rules/$r missing"; fi
done
if [ -L "$CLAUDE_HOME/rules" ]; then fail "rules/ is a symlink (Cowork skips it)"; fi

hr "~/claude project layout"
if [ -f "$PROJ_ROOT/MANIFEST.md" ]; then pass "MANIFEST.md present"; else fail "MANIFEST.md missing"; fi
while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    d="$PROJ_ROOT/$rel"
    if [ ! -d "$d" ]; then
        fail "$rel missing"
    elif [ ! -f "$d/CLAUDE.md" ]; then
        fail "$rel has no CLAUDE.md"
    elif grep -q '^# <project name>' "$d/CLAUDE.md" || grep -q '<One or two lines' "$d/CLAUDE.md"; then
        printf '  warn  %s CLAUDE.md is still the untouched template — run /init there\n' "$rel"
    else
        pass "$rel"
    fi
done < <(grep -E '^\| [^|]+\| [^|]+\| [^|]*\| ~/claude/' "$HERE/MANIFEST-template.md" \
    | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $5); print $5}' | sed "s|^~/claude/||")
if [ -d "$PROJ_ROOT/brain-hub-sync" ]; then pass "brain-hub-sync/ present"; else fail "brain-hub-sync/ missing"; fi
if [ "$(stat -c %U "$PROJ_ROOT" 2>/dev/null)" = "$(id -un)" ]; then
    pass "~/claude owned by $(id -un)"
else
    fail "~/claude is owned by $(stat -c %U "$PROJ_ROOT" 2>/dev/null) — should be $(id -un)"
fi

hr "Brain Hub sync (Phase 8)"
if have rclone; then
    if rclone listremotes 2>/dev/null | grep -q '^gdrive:$'; then
        pass "rclone remote gdrive: configured"
    else
        fail "rclone remote gdrive: not configured (see brain-hub-sync/README.md)"
    fi
    mode="$(stat -c %a "$HOME/.config/rclone/rclone.conf" 2>/dev/null || echo missing)"
    if [ "$mode" = "600" ]; then pass "rclone.conf mode 600"; else fail "rclone.conf mode $mode"; fi
    if systemctl --user is-enabled rclone-brain-hub.timer >/dev/null 2>&1; then
        pass "rclone-brain-hub.timer enabled"
        if systemctl --user is-active rclone-brain-hub.timer >/dev/null 2>&1; then
            pass "rclone-brain-hub.timer active — next: $(systemctl --user list-timers rclone-brain-hub.timer --no-legend 2>/dev/null | awk '{print $1, $2, $3}')"
        else
            fail "rclone-brain-hub.timer enabled but not active"
        fi
        if loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
            pass "lingering enabled (timer runs when logged out)"
        else
            fail "lingering off — run: loginctl enable-linger $(id -un)"
        fi
    else
        fail "rclone-brain-hub.timer not enabled"
    fi
else
    skip "rclone not installed — Phase 8 not started"
fi

hr "Cowork (Phase 7)"
if [ -d "$HOME/.config/Claude" ]; then
    pass "Claude Desktop config present"
    echo "        Manual check: open Cowork on ~/claude, ask it to read ~/.claude/CLAUDE.md, confirm it sees the rules."
else
    skip "Claude Desktop not detected — Phase 7 is a manual test on this machine"
fi

hr "Result"
if [ "$fails" -eq 0 ]; then
    echo "  All automated checks passed."
else
    echo "  $fails check(s) failed."
fi
exit "$fails"
