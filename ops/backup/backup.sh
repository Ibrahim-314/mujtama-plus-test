#!/bin/sh
# Nightly encrypted logical backup (Phase 3): pg_dump (custom format) → AES-256 (openssl, PBKDF2) → retention.
set -eu
TS=$(date -u +%Y%m%dT%H%M%SZ); OUT="${BACKUP_DIR:-/backups}/mujtama-$TS.dump.enc"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:-/run/secrets/backup_passphrase}"
pg_dump --format=custom --no-owner --compress=6 | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass file:"$PASS_FILE" -out "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
find "${BACKUP_DIR:-/backups}" -name 'mujtama-*.dump.enc*' -mtime +"${RETAIN_DAYS:-14}" -delete
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
# Off-site copy (R2/S3): uncomment once credentials exist
# aws s3 cp "$OUT" "s3://$BACKUP_BUCKET/" --endpoint-url "$S3_ENDPOINT"
