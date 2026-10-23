#!/bin/sh
# One-command deploy (v2.68): tag → railway up → wait → verify /api/health version. Prints the rollback on failure.
set -e
export PATH=/workspace/.cache/bin:$PATH
VER=$(node -p "require('./package.json').version"); URL=${URL:-https://mjt.up.railway.app}
git tag -a "v$VER" -m "v$VER" 2>/dev/null || true
railway up --detach
for i in $(seq 1 20); do
  L=$(railway deployment list 2>/dev/null | sed -n 2p); echo "$L"
  echo "$L" | grep -qE 'SUCCESS' && break
  echo "$L" | grep -qE 'FAILED|CRASHED' && { echo "DEPLOY FAILED — rollback: railway redeploy of previous deployment, or git checkout <prev tag> && railway up"; exit 1; }
  sleep 8
done
H=$(curl -s -m 10 "$URL/api/health"); echo "$H"
echo "$H" | grep -q "\"version\":\"$VER\"" && echo "OK v$VER live" || { echo "HEALTH MISMATCH"; exit 1; }
