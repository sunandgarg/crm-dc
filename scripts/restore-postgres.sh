#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${1:?Usage: scripts/restore-postgres.sh backup.dump}"
if [ "${CONFIRM_RESTORE:-}" != "RESTORE" ]; then
  echo "Set CONFIRM_RESTORE=RESTORE to confirm this destructive operation." >&2
  exit 2
fi
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$DATABASE_URL" "$1"
