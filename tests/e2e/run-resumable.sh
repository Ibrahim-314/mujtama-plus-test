#!/usr/bin/env bash
# v2.145.2 — resumable E2E runner.
# Runs tests/e2e/*.e2e.test.js (or the files given) one at a time and records every file's result in a state file,
# so a sandbox/container restart loses nothing: run it again and finished files are skipped.
#
#   tests/e2e/run-resumable.sh                      # all files, state in .e2e-state/state.tsv, logs in .e2e-state/logs/
#   tests/e2e/run-resumable.sh nav.e2e.test.js p74.e2e.test.js
#   E2E_STATE_DIR=/tmp/run1 tests/e2e/run-resumable.sh   # separate run
#   tests/e2e/run-resumable.sh --rerun-failed       # run only the files whose last result was "fail" (each ONCE, no retry loop)
#   tests/e2e/run-resumable.sh --status             # print the summary and exit
#   tests/e2e/run-resumable.sh --reset              # forget the state and start over
#
# State file (TSV, append-only, the last line for a file wins): file <TAB> status <TAB> rc <TAB> seconds <TAB> iso-time
#   status = running | pass | fail. A file left "running" (the process was killed) is run again on the next start.
# E2E_TIMEOUT (seconds per file, default 600). Exit code: 0 when every selected file passed, 1 otherwise.
set -u
cd "$(dirname "$0")/../.." || exit 2
DIR="${E2E_STATE_DIR:-.e2e-state}"
STATE="$DIR/state.tsv"
LOGS="$DIR/logs"
TMO="${E2E_TIMEOUT:-600}"
MODE=run
FILES=()
for a in "$@"; do
  case "$a" in
    --status) MODE=status ;;
    --reset) MODE=reset ;;
    --rerun-failed) MODE=failed ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) FILES+=("$(basename "$a")") ;;
  esac
done
mkdir -p "$LOGS"
touch "$STATE"
last_status() { awk -F'\t' -v f="$1" '$1==f{s=$2} END{print s}' "$STATE"; }
summary() {
  awk -F'\t' '{s[$1]=$2} END{for(f in s) c[s[f]]++; printf "pass=%d fail=%d running(interrupted)=%d\n", c["pass"], c["fail"], c["running"]; for(f in s) if(s[f]!="pass") print "  " s[f] "\t" f}' "$STATE"
}
if [ "$MODE" = reset ]; then rm -rf "$DIR"; echo "state cleared ($DIR)"; exit 0; fi
if [ "$MODE" = status ]; then summary; exit 0; fi
if [ ${#FILES[@]} -eq 0 ]; then
  while IFS= read -r f; do FILES+=("$(basename "$f")"); done < <(ls tests/e2e/*.e2e.test.js | sort)
fi
for f in "${FILES[@]}"; do
  [ -f "tests/e2e/$f" ] || { echo "missing: tests/e2e/$f" >&2; continue; }
  st="$(last_status "$f")"
  if [ "$MODE" = failed ]; then [ "$st" = fail ] || continue
  else [ "$st" = pass ] || [ "$st" = fail ] && continue; fi
  printf '%s\trunning\t-\t-\t%s\n' "$f" "$(date -u +%FT%TZ)" >> "$STATE"
  s=$(date +%s)
  timeout "$TMO" node --test "tests/e2e/$f" < /dev/null > "$LOGS/$f.log" 2>&1
  rc=$?
  [ $rc -eq 0 ] && res=pass || res=fail
  printf '%s\t%s\t%s\t%s\t%s\n' "$f" "$res" "$rc" "$(( $(date +%s) - s ))" "$(date -u +%FT%TZ)" >> "$STATE"
  echo "$res $f ($(( $(date +%s) - s ))s)"
done
summary
for f in "${FILES[@]}"; do [ "$(last_status "$f")" = pass ] || exit 1; done
exit 0
