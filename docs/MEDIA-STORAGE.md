# Media storage in the database (`STORAGE_DRIVER=db`)

Opt-in. With no `STORAGE_DRIVER` set, nothing changes (local disk under `STORAGE_DIR`, or S3 when configured).

| Env | Default | Meaning |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `db` stores blobs in table `blobs` (migration `013_blobs`) |
| `STORAGE_DB_MAX_FILE_MB` | 25 | per-file cap, HTTP 413 `file_too_large` above it |
| `STORAGE_DB_MAX_TOTAL_MB` | 300 | total cap, HTTP 413 `storage_full` above it |
| `STORAGE_DB_WARN_PCT` | 80 | log `storage usage above warning threshold` once over this share |

What is stored: `/api/media` uploads, video/audio processing outputs (HLS playlists + segments, MP4, poster, M4A),
captions, avatars/covers, and chat attachments (`chat/<id>`). Local disk stays the working copy for ffmpeg.

Serving: `/media/<name>` (same URL, ext-based Content-Type, same cache headers, Range with the same 1 MiB cap on
open-ended ranges) and `/api/chat/blobs/:id` (same member-only auth, Content-Type from `chat_blobs.mime`; no Range,
as before). Chat keys are never reachable through `/media/`.

Read-through: a key missing in the DB but present on disk is served and copied into the DB; the disk file is kept.
Explicit deletes (expired / deleted chat attachments) remove the row and any disk copy, as the local driver does.

Rollout (later, not done yet). Caveat: on a host whose disk is wiped on deploy, deploying this build itself wipes
the media that exists only on the current disk, so read-through cannot recover it afterwards. Capture it first
(tar of `STORAGE_DIR` from the running container, see `ops/backup/`), then deploy with `STORAGE_DRIVER=db`, then
`node server/scripts/import-media.js media.tar` with `DATABASE_URL` pointing at the database. Media uploaded after
the switch is durable. Check migrations on a copy first: `node server/scripts/verify-migrations.js --static`
(and `--apply` against a restored copy, never production).

## Resumable uploads (v2.70) — data map
`upload_sessions` (migration 072): one row per chunked upload (`POST /api/media/uploads`): owner (user id), sanitized
original filename, mime, kind, declared size, chunk size, total chunks, received chunk indexes (JSON), status `open|done`,
the resulting `media_id`, created/updated/expires timestamps. The chunk bytes are temp files under
`<STORAGE_DIR>/tmp/uploads/<id>/`, never in the database. Sessions expire 24 h after the last chunk
(`MEDIA_UPLOAD_TTL_H`); the sweep (boot + every 30 min) deletes the row and its temp files. Someone else's session → 403,
unknown/expired → 404. Complete runs the same `ingest()` as `POST /api/media` (magic bytes, per-kind limit, durable store, processing queue).
