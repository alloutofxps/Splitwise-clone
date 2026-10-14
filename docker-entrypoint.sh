#!/bin/sh
set -e

# Fail here, loudly, rather than at the first request.
#
# `identity.ts` throws when DIVVY_SECRET is missing in production, which means
# a container started without one boots fine, serves a page, and 500s the
# moment anybody signs in. Checking at startup turns that into a message the
# person deploying will actually read.
if [ -z "$DIVVY_SECRET" ] || [ ${#DIVVY_SECRET} -lt 16 ]; then
  echo "DIVVY_SECRET is missing or shorter than 16 characters." >&2
  echo "It signs identity cookies; losing or changing it signs everybody out." >&2
  echo "Generate one with:  openssl rand -hex 32" >&2
  exit 1
fi

DB_FILE="${DATABASE_URL#file:}"
DB_FILE="${DB_FILE%%\?*}"
DATA_DIR="$(dirname "$DB_FILE")"

# Run the rest as the unprivileged `node` user. Started as root, the script
# hands the data directory over and re-executes itself through gosu; if the
# platform will not allow the chown, it carries on as root rather than failing
# to boot, and says so.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if chown -R node:node "$DATA_DIR" 2>/dev/null; then
    exec gosu node "$0" "$@"
  fi
  echo "warning: could not give $DATA_DIR to the node user; running as root" >&2
fi

# Off-site replication, when configured. On a fresh volume the database is
# first restored from the replica, so losing the disk loses at most the last
# few seconds of writes rather than everything.
LITESTREAM_CONFIG=/tmp/litestream.yml
if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  cat > "$LITESTREAM_CONFIG" <<EOF
dbs:
  - path: $DB_FILE
    replica:
      url: $LITESTREAM_REPLICA_URL
EOF
  if [ ! -f "$DB_FILE" ]; then
    echo "Restoring $DB_FILE from $LITESTREAM_REPLICA_URL (if a replica exists)"
    litestream restore -config "$LITESTREAM_CONFIG" -if-replica-exists "$DB_FILE"
  fi
fi

# A copy of the database before every migration, so a migration that goes
# wrong can be undone. Nothing is writing yet, so copying the file together
# with its WAL is a consistent snapshot. The newest five are kept.
if [ -f "$DB_FILE" ]; then
  BACKUP_DIR="${DIVVY_BACKUP_DIR:-$DATA_DIR/backups}"
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$DB_FILE" "$BACKUP_DIR/pre-migrate-$STAMP.db"
  [ -f "$DB_FILE-wal" ] && cp "$DB_FILE-wal" "$BACKUP_DIR/pre-migrate-$STAMP.db-wal"
  ls -1t "$BACKUP_DIR"/pre-migrate-*.db 2>/dev/null | tail -n +6 | while read -r old; do
    rm -f "$old" "$old-wal"
  done
fi

# Applied on every boot, not just the first. `migrate deploy` is a no-op when
# there is nothing pending, so a redeploy that adds a migration picks it up
# without anybody remembering to run a release step.
echo "Applying migrations to $DATABASE_URL"
./node_modules/.bin/prisma migrate deploy

START="./node_modules/.bin/next start --port ${PORT:-3000} --hostname 0.0.0.0"
if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  # Litestream supervises the app and replicates while it runs.
  exec litestream replicate -config "$LITESTREAM_CONFIG" -exec "$START"
fi
exec $START
