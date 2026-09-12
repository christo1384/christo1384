#!/usr/bin/env bash
# Nightly backup of the database and receipt files.
#   ./bin/backup.sh [destination-dir]
# Uses SQLite's VACUUM INTO, which takes a consistent snapshot while the app runs.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_FILE="${DB_FILE:-$APP_DIR/data/ops.db}"
UPLOADS_DIR="${UPLOADS_DIR:-$APP_DIR/data/uploads}"
DEST="${1:-${BACKUP_DIR:-$APP_DIR/backups}}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST"

if [ ! -f "$DB_FILE" ]; then
  echo "No database at $DB_FILE" >&2
  exit 1
fi

node --disable-warning=ExperimentalWarning "$APP_DIR/bin/snapshot.js" "$DB_FILE" "$DEST/ops-$STAMP.db"

if [ -d "$UPLOADS_DIR" ] && [ -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  tar -czf "$DEST/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
fi

find "$DEST" -maxdepth 1 -name 'ops-*.db' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "Backed up to $DEST (ops-$STAMP.db), keeping $KEEP_DAYS days."
