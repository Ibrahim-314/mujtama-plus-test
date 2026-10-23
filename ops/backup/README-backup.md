# Production backup (read-only) — short note

Status: helper only. Not run against production; the `db` mode is untested locally (no `pg_dump`/`psql` client in
the build sandbox). The `media` and `emit` modes were tested locally. Needs a computer with the Railway CLI.

```sh
npm i -g @railway/cli        # or: brew install railway
railway login
railway link                 # pick project "mujtama-plus"
# copy the script into each container's /tmp (paste it, or: railway ssh --service <svc> then `cat > /tmp/prod-backup.sh`)
railway ssh --service Postgres -- sh /tmp/prod-backup.sh db       # prints dump path, TOC count, row counts, sha256
railway ssh --service web      -- sh /tmp/prod-backup.sh media    # prints tar path, file count, bytes, sha256
# download through the terminal as base64 (binary-safe), then decode and check the printed sha256
railway ssh --service Postgres -- sh /tmp/prod-backup.sh emit /tmp/mujtama-<TS>.dump > db.b64
sed '1d;$d' db.b64 | base64 -d > mujtama.dump && shasum -a 256 mujtama.dump
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in mujtama.dump -out mujtama.dump.enc   # passphrase only you keep
```

Why base64: whether `railway ssh` passes raw binary stdout unchanged was not verified (it runs a terminal session
over a websocket; terminals can rewrite line endings). Base64 text with a sha256 header is safe either way; the
check after decoding proves the copy is exact. Restore: `pg_restore --list mujtama.dump` then `ops/backup/restore-test.sh`.

Media after a switch to `STORAGE_DRIVER=db`: `node server/scripts/import-media.js mujtama-media.tar` (needs `DATABASE_URL`).
