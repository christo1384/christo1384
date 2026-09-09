#!/usr/bin/env bash
# Applies the Claude Code drafts in this folder to the current user's home.
#
# DRY RUN BY DEFAULT. Prints what it would do and touches nothing.
#     bash apply.sh            # show the plan
#     bash apply.sh --apply    # do it
#
# What --apply does, and nothing more:
#   1. Backs up any existing ~/.claude/CLAUDE.md, ~/.claude/settings.json and
#      ~/.claude/rules/ to ~/.claude/backup-<timestamp>/ before overwriting.
#   2. Copies claude-global/CLAUDE.md, settings.json and rules/*.md into
#      ~/.claude/ as REAL FILES (Cowork ignores a symlinked CLAUDE.md).
#   3. Creates ~/claude/ and the project folders listed in
#      MANIFEST-template.md, plus ~/claude/brain-hub-sync/. Existing folders
#      are left alone. Copies MANIFEST-template.md to ~/claude/MANIFEST.md
#      only if no MANIFEST.md exists yet.
#   4. Drops project-template/ into each NEW project folder (CLAUDE.md,
#      .gitignore, .claude/skills/). Never into a folder that already exists.
#
# It does not install anything, does not touch rclone/systemd/Cowork, does
# not run git init, and never deletes a file.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

CLAUDE_HOME="$HOME/.claude"
PROJ_ROOT="$HOME/claude"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$CLAUDE_HOME/backup-$STAMP"

say()  { printf '%s\n' "$*"; }
plan() { if [ "$APPLY" -eq 1 ]; then printf '  doing: %s\n' "$*"; else printf '  would: %s\n' "$*"; fi; }

# Sanity: refuse to run from inside the sandbox this was written in, or as root.
if [ "$(id -u)" -eq 0 ]; then
    say "Refusing to run as root. Run as the user who owns ~/claude."; exit 1
fi
for f in claude-global/CLAUDE.md claude-global/settings.json claude-global/rules MANIFEST-template.md project-template; do
    [ -e "$HERE/$f" ] || { say "Missing $HERE/$f. Run from the allengates01-setup folder."; exit 1; }
done
if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$HERE/claude-global/settings.json" \
        || { say "claude-global/settings.json is not valid JSON. Fix it before applying."; exit 1; }
fi

if [ "$APPLY" -eq 1 ]; then say "APPLYING to $HOME"; else say "DRY RUN for $HOME (add --apply to execute)"; fi

# ---- 1 + 2. ~/.claude ------------------------------------------------------
say ""; say "== ~/.claude =="
mkdir_p() { plan "mkdir -p $1"; [ "$APPLY" -eq 1 ] && mkdir -p "$1"; return 0; }
backup_if_exists() {
    local target="$1"
    if [ -e "$target" ] || [ -L "$target" ]; then
        plan "backup $target -> $BACKUP/"
        if [ "$APPLY" -eq 1 ]; then
            mkdir -p "$BACKUP"
            cp -a "$target" "$BACKUP/"
        fi
    fi
}
copy_file() {
    local src="$1" dst="$2"
    if [ -L "$dst" ]; then
        plan "remove symlink $dst (Cowork skips symlinked user-scope files)"
        [ "$APPLY" -eq 1 ] && rm "$dst"
    fi
    if [ -e "$dst" ] && cmp -s "$src" "$dst"; then
        say "  same:  $dst (unchanged)"
        return 0
    fi
    plan "copy  $src -> $dst"
    [ "$APPLY" -eq 1 ] && install -m 644 "$src" "$dst"
    return 0
}

mkdir_p "$CLAUDE_HOME"
backup_if_exists "$CLAUDE_HOME/CLAUDE.md"
backup_if_exists "$CLAUDE_HOME/settings.json"
backup_if_exists "$CLAUDE_HOME/rules"
copy_file "$HERE/claude-global/CLAUDE.md" "$CLAUDE_HOME/CLAUDE.md"
copy_file "$HERE/claude-global/settings.json" "$CLAUDE_HOME/settings.json"
mkdir_p "$CLAUDE_HOME/rules"
for r in "$HERE"/claude-global/rules/*.md; do
    copy_file "$r" "$CLAUDE_HOME/rules/$(basename "$r")"
done

# ---- 3 + 4. ~/claude ---------------------------------------------------------
say ""; say "== ~/claude =="
mkdir_p "$PROJ_ROOT"
mkdir_p "$PROJ_ROOT/brain-hub-sync"
if [ -e "$PROJ_ROOT/MANIFEST.md" ]; then
    say "  keep:  $PROJ_ROOT/MANIFEST.md already exists (not overwritten)"
else
    plan "copy  MANIFEST-template.md -> $PROJ_ROOT/MANIFEST.md"
    [ "$APPLY" -eq 1 ] && install -m 644 "$HERE/MANIFEST-template.md" "$PROJ_ROOT/MANIFEST.md"
fi

# Project paths come from the table in MANIFEST-template.md: the last column, ~/claude/<path>.
grep -E '^\| [^|]+\| [^|]+\| [^|]*\| ~/claude/' "$HERE/MANIFEST-template.md" \
    | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $5); print $5}' \
    | sed "s|^~/claude/||" \
    | while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        dir="$PROJ_ROOT/$rel"
        if [ -d "$dir" ]; then
            say "  keep:  $dir already exists (template not applied)"
            continue
        fi
        plan "mkdir -p $dir and seed from project-template/"
        if [ "$APPLY" -eq 1 ]; then
            mkdir -p "$dir/.claude/skills"
            install -m 644 "$HERE/project-template/CLAUDE.md" "$dir/CLAUDE.md"
            install -m 644 "$HERE/project-template/.gitignore" "$dir/.gitignore"
            touch "$dir/.claude/skills/.gitkeep"
            # Put the project's own name in the heading so the placeholder is obvious.
            sed -i "1s|.*|# $(basename "$rel")|" "$dir/CLAUDE.md"
        fi
    done

say ""
if [ "$APPLY" -eq 1 ]; then
    say "Done. Backups (if any) are in $BACKUP"
    say "Next: run 'claude doctor', then open a project folder and run /init to fill in its CLAUDE.md."
else
    say "Nothing changed. Re-run with --apply to execute the plan above."
fi
