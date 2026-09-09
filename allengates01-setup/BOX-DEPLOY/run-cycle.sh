#!/usr/bin/env bash
# Driver loop for the allengates01 deploy agent.
#
#   bash run-cycle.sh --max-cycles 1     # first run: one ticket, then read the report
#   bash run-cycle.sh                    # loop until STOP, empty queue, or 20 cycles
#   bash run-cycle.sh --dry-run          # print what a cycle would do, run nothing
#
# Each cycle: git pull → stop checks → refresh sudo → one headless Claude
# Code run (one ticket) → sweep-commit anything the agent left → push → sleep.
#
# Run this from a FRESH clone (see KICKOFF-ALLENGATES01.md). Keep the box
# awake. Ctrl+C stops it between cycles.
#
# Permissions: the agent gets Read/Grep/Glob/Edit/Write/Bash for the run.
# The deny rules in ~/.claude/settings.json (recursive rm, force-push,
# secret paths) still apply. If a cycle stalls on a permission prompt, add
# the specific command to the allow list in ~/.claude/settings.json rather
# than widening anything here.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

MAX_CYCLES=20
MODEL="sonnet"
SLEEP=30
DRY=0
while [ $# -gt 0 ]; do
    case "$1" in
        --max-cycles) MAX_CYCLES="$2"; shift 2 ;;
        --model) MODEL="$2"; shift 2 ;;
        --sleep) SLEEP="$2"; shift 2 ;;
        --dry-run) DRY=1; shift ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

mkdir -p logs reports snapshots evidence
LOG="logs/driver-$(date +%Y%m%d-%H%M%S).log"
log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }

# Refuse to run as root: files must be owned by Chris's user, and sudo is
# used explicitly inside tickets.
if [ "$(id -u)" -eq 0 ]; then echo "Run as your own user, not root." >&2; exit 1; fi
command -v claude >/dev/null 2>&1 || { echo "claude is not on PATH. See KICKOFF-ALLENGATES01.md step 1." >&2; exit 1; }

CYCLE_PROMPT='Read CLAUDE.md and WORK-CLAUDE.md in this directory, then run exactly one cycle of the contract: pull, read OVERWATCH.md, take the first ready ticket whose dependencies are done, gate it against GO.md, snapshot, do it, verify, write the report, update QUEUE.md, commit and push, exit. One ticket only. If nothing is ready, say "queue empty" and exit.'

# Cache the sudo timestamp once at the start (prompts for the password
# here, never inside a cycle) and refresh it between cycles. Debian's
# default timeout is 15 minutes, longer than one cycle.
if [ "$DRY" -eq 0 ]; then
    sudo -v || log "sudo -v failed; tickets needing sudo will report 'sudo expired'."
fi

cycle=0
while [ "$cycle" -lt "$MAX_CYCLES" ]; do
    cycle=$((cycle + 1))
    log "=== cycle $cycle/$MAX_CYCLES ==="

    if ! git pull --ff-only -q; then log "git pull failed; stopping."; break; fi

    if grep -qE '^STOP\s*$' OVERWATCH.md; then log "OVERWATCH says STOP."; break; fi
    if ! grep -q 'Status: \*\*SIGNED\*\*' GO.md; then log "GO.md is not SIGNED; nothing will be written. Sign it and re-run."; break; fi
    if ! grep -qE '\| ready \|$' QUEUE.md; then log "No ready tickets; queue empty."; break; fi

    if [ "$DRY" -eq 1 ]; then
        log "DRY RUN: would run one headless cycle with model $MODEL, max 60 turns, tools Read,Grep,Glob,Edit,Write,Bash"
        log "Next ready ticket: $(grep -E '\| ready \|$' QUEUE.md | head -n 1 | cut -d'|' -f2 | tr -d ' ')"
        break
    fi

    sudo -n -v 2>/dev/null || log "sudo timestamp expired; this cycle's sudo steps will be reported as partial."

    claude -p "$CYCLE_PROMPT" \
        --model "$MODEL" \
        --max-turns 60 \
        --output-format text \
        --allowedTools "Read" "Grep" "Glob" "Edit" "Write" "Bash" \
        2>&1 | tee -a "$LOG" | tail -n 40

    # Sweep: commit anything the agent wrote but did not commit, then push.
    if [ -n "$(git status --porcelain)" ]; then
        git add -A
        git commit -q -m "driver sweep: cycle $cycle $(date +%Y-%m-%dT%H:%M:%S)" || true
    fi
    git push -q || log "push failed; will retry next cycle."

    latest="$(ls -t reports/*.md 2>/dev/null | head -n 1)"
    [ -n "$latest" ] && log "latest report: $latest ($(sed -n 2p "$latest"))"

    if grep -qE '^STOP\s*$' OVERWATCH.md; then log "OVERWATCH says STOP."; break; fi
    log "sleeping ${SLEEP}s"
    sleep "$SLEEP"
done
log "driver finished after $cycle cycle(s). Log: $LOG"
