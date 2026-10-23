#!/bin/sh
# Read-only production backup helper — run INSIDE a Railway container through `railway ssh` (see README-backup.md).
#   sh prod-backup.sh db      # Postgres container: pg_dump -Fc → verify with pg_restore --list → exact row counts
#   sh prod-backup.sh media   # web container: tar of $STORAGE_DIR (paths preserved) → file count, bytes, sha256
#   sh prod-backup.sh emit F  # print file F as base64 between markers (binary-safe download over a terminal)
# Writes only under ${BACKUP_OUT:-/tmp}. Reads the database; never modifies it. Prints names, counts, sizes and
# hashes only — never credentials, connection strings or row data.
set -eu
OUT_DIR="${BACKUP_OUT:-/tmp}"; TS=$(date -u +%Y%m%dT%H%M%SZ)
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else openssl dgst -sha256 "$1" | sed 's/.*= //'; fi; }
bytes() { wc -c < "$1" | tr -d ' '; }
case "${1:-}" in
  db)
    # connection comes from the container's own environment (DATABASE_URL, or PG*/POSTGRES_* variables); never echoed
    if [ -n "${DATABASE_URL:-}" ]; then CONN="$DATABASE_URL"; else CONN="postgresql://${PGUSER:-${POSTGRES_USER:-postgres}}@localhost:${PGPORT:-5432}/${PGDATABASE:-${POSTGRES_DB:-railway}}"; export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"; fi
    F="$OUT_DIR/mujtama-$TS.dump"
    pg_dump -Fc --no-owner --no-privileges -d "$CONN" -f "$F"
    TOC=$(pg_restore --list "$F" | grep -vc '^;' || true)
    echo "dump: $F"; echo "toc_entries: $TOC"; echo "bytes: $(bytes "$F")"; echo "sha256: $(sha "$F")"
    echo "row counts (exact COUNT(*), schema public):"
    psql -d "$CONN" -At -v ON_ERROR_STOP=1 -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1" | while read -r t; do
      n=$(psql -d "$CONN" -At -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM public.\"$t\"")
      printf '  %-32s %s\n' "$t" "$n"
    done ;;
  media)
    SRC="${STORAGE_DIR:-/data/storage}"; F="$OUT_DIR/mujtama-media-$TS.tar"
    [ -d "$SRC" ] || { echo "no storage dir: $SRC"; exit 1; }
    tar -cf "$F" -C "$SRC" .
    echo "tar: $F"; echo "files: $(find "$SRC" -type f | wc -l | tr -d ' ')"; echo "source_bytes: $(du -sb "$SRC" 2>/dev/null | cut -f1 || echo n/a)"
    echo "tar_bytes: $(bytes "$F")"; echo "sha256: $(sha "$F")" ;;
  emit)
    [ -f "${2:-}" ] || { echo "usage: prod-backup.sh emit <file>"; exit 2; }
    echo "-----BEGIN MUJTAMA BACKUP $(basename "$2") sha256=$(sha "$2")-----"; base64 "$2"; echo "-----END MUJTAMA BACKUP-----" ;;
  *) echo "usage: prod-backup.sh db | media | emit <file>"; exit 2 ;;
esac
