#!/bin/sh
# Monthly restore drill (Phase 3): restores the newest backup into a scratch database and runs
# sanity checks. A backup is only real once it has been restored.
set -eu
FILE=${1:-$(ls -t "${BACKUP_DIR:-/backups}"/mujtama-*.dump.enc | head -1)}
PASS_FILE="${BACKUP_PASSPHRASE_FILE:-/run/secrets/backup_passphrase}"
SCRATCH=mujtama_restore_$(date +%s)
sha256sum -c "$FILE.sha256"
createdb "$SCRATCH"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:"$PASS_FILE" -in "$FILE" | pg_restore --no-owner -d "$SCRATCH"
USERS=$(psql -At -d "$SCRATCH" -c "select count(*) from users"); POSTS=$(psql -At -d "$SCRATCH" -c "select count(*) from posts")
MIG=$(psql -At -d "$SCRATCH" -c "select count(*) from schema_migrations")
dropdb "$SCRATCH"
echo "restore ok: $FILE → users=$USERS posts=$POSTS migrations=$MIG"
