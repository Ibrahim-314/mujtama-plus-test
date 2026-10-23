#!/bin/sh
# v2.68 off-site backup pull: downloads GET /api/ops/backup into $DEST, verifies it fully (decrypt + gunzip + per-table counts),
# keeps the newest $KEEP verified copies. Token/passphrase come from files, never printed.
set -eu
URL=${URL:-https://mjt.up.railway.app}; DEST=${DEST:-/workspace/backups/db}; KEEP=${KEEP:-7}
SEC=${SEC:-/workspace/.secrets}; TOKEN=$(cat "$SEC/backup_token"); export BACKUP_PASSPHRASE_FILE="$SEC/backup_passphrase"
mkdir -p "$DEST"; TS=$(date -u +%Y%m%dT%H%M%SZ); F="$DEST/mujtama-$TS.jsonl.gz.enc"
code=$(curl -sS -m 1100 -o "$F.part" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$URL/api/ops/backup")
[ "$code" = 200 ] || { rm -f "$F.part"; echo "FAILED http $code"; exit 1; }
mv "$F.part" "$F"
OUT=$(node "$(dirname "$0")/../../tools/backup-restore.mjs" verify "$F") || { mv "$F" "$F.bad"; echo "FAILED verify"; exit 1; }
sha256sum "$F" | cut -d' ' -f1 > "$F.sha256"
ls -1t "$DEST"/mujtama-*.jsonl.gz.enc | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old" "$old.sha256"; done
echo "OK $(du -h "$F" | cut -f1) $OUT"
