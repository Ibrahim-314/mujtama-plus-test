# التوسع الأفقي — Horizontal scaling (Phase 48)

**Default = unchanged.** With no new env vars the app runs exactly as before: one process (`ROLE=all`), in-process event
bus, in-memory cache and rate limits, SSE/WebSocket from the same node. Every adapter below activates only by env var and
falls back to the in-process behaviour if its server is unreachable at boot (`SCALE_CONNECT_TIMEOUT_MS`, 3000) or drops later.
No new npm packages: Redis and NATS are spoken by zero-dependency clients (`server/lib/redis-lite.js`, `server/lib/nats-lite.js`).

## Env vars
| Var | Effect |
|---|---|
| `REDIS_URL` | `redis://[:pw@]host:6379[/db]` or `rediss://`. Enables shared cache, distributed rate limits, realtime fan-out. |
| `REDIS_PREFIX` | key/channel prefix (default `mp:`) — lets several environments share one Redis. |
| `REDIS_RATE_LIMIT=0` | keep rate limits in-process even with Redis. |
| `REDIS_SESSION_CACHE_MS` | session lookup cache TTL (default **0 = off**, max 60000). Logout / revoke / revoke-others invalidate immediately; other user-row changes (ban, role) are seen within the TTL. Recommended 5000. |
| `REDIS_TIMEOUT_MS` | per-command timeout (1000). |
| `NATS_URL` | `nats://[user:pw@\|token@]host:4222` (plaintext; TLS-required servers unsupported by the minimal client). Event bus over NATS. |
| `NATS_QUEUE` / `NATS_SUBJECT_PREFIX` | queue group (`mujtama`) / subject prefix (`mujtama.evt.`). |
| `ROLE` | `web` \| `worker-media` \| `worker-notify` \| `worker-search` \| `all` (default). |
| `CDN_CACHE=1` | adds `CDN-Cache-Control` to static responses (see CDN). |
| `SHARD_COUNT`, `SHARD_<n>_DATABASE_URL` | sharding readiness only (helper), no routing yet. |

## What each adapter does
- **Cache (`SharedCache`)** — L1 = the existing in-process TTL map (sync `get` keeps working); L2 = Redis. `wrap()` checks L1 → Redis
  (another node's warm value) → computes once (single-flight). `del(prefix)` clears L1, publishes an invalidation on `mp:inv` so every
  node drops its L1, and SCAN+DELs the L2 keys. Only plain JSON data goes to Redis (Dates/Buffers/class instances stay L1-only).
- **Rate limits (`DistributedRateLimiter`)** — `rl.hit()` stays synchronous (all services + the automod trust-tier wrapper call it inline).
  Each allowed hit also `INCR`s a Redis fixed window; the last cluster count is merged with the local sliding window, so a key is limited
  cluster-wide after ≤1 Redis round trip per node (bounded overshoot ≈ nodes−1 hits). `rl.hitAsync()` is exact for new code.
- **Event bus (`NatsEventBus`)** — `bus.emit` publishes `mujtama.evt.<EVENT>`; all nodes subscribe with one queue group, so **each event
  is handled once per cluster** (same as one process today) and spreads over nodes. Non-JSON payloads, or NATS down/backed-up → in-process.
  Same `bus.on/emit` API; `*` subscribers still see everything. Handlers on the emitting node run after a NATS round trip (sub-ms in-cluster).
- **Realtime fan-out** — `ctx.realtime.send/broadcast` (which already feeds SSE + WebSocket) delivers locally and publishes on `mp:rt`;
  other nodes deliver to their own connected users. No sticky sessions needed; a user's tabs on different nodes all get updates instantly.
- **Sessions** — stay in the database (source of truth, shared by all nodes). Optional Redis cache of the token → user lookup (above).

## Roles (process split)
`node server/server.js` with `ROLE=…` (same image). `web` serves HTTP/SSE/WS and runs everything not owned by a worker; workers
answer only `/api/health`, `/healthz`, `/readyz` (others 404 `worker_role`), refuse WebSocket upgrades, skip demo seeding and the
in-process interval jobs, and run only their own work:

| Role | Queue job kinds | Leased scheduled jobs |
|---|---|---|
| `worker-media` | `video`, `audio`, `transcribe`, `automod.deep` | — |
| `worker-notify` | `notify.push`, `notify.email`, `mail.send` | `weeklyDigest`, `eventsTick`, `readLater`, `modDigest` |
| `worker-search` | — | `searchSync`, `savedSearchAlerts`, `trendsCompute`, `assistant.index` |

Queue claiming already filters by registered kinds and scheduled jobs already hold DB leases, so any number of replicas per role is safe.
If you run `ROLE=web` you must also run every worker role (otherwise those jobs wait in `media_jobs`). The old
`MEDIA_WORKER=external` + `node server/worker.js` still works.

## Kubernetes (`deploy/k8s`, files only)
Kustomize bundle: Namespace, ConfigMap, Deployment+Service `web`, Deployments `worker-media|notify|search`, HPAs (CPU 65–70 %, memory 80 %,
fast scale-up, 5-min scale-down window), PDB, nginx Ingress with long timeouts for SSE/WS. Secrets come from `secret.example.yaml`
(example only). Requires shared media storage (S3/R2 or `STORAGE_DRIVER=db`), PostgreSQL (ideally via `ops/pgbouncer`), Redis and NATS.

## Multi-region CDN near the Gulf
Cloudflare in front of the origin (free plan is enough for static caching); Cloudflare has PoPs in Jeddah, Riyadh, Dammam, Dubai,
Muscat, Kuwait, Doha, Bahrain, so cached assets are served in-country.
- Hashed assets (`app-<hash>.js|css`, chunks): `Cache-Control: public, max-age=31536000, immutable` (already) — browsers and edge keep forever.
- With `CDN_CACHE=1`: `CDN-Cache-Control` = `public, max-age=31536000, immutable` (hashed), `public, max-age=$CDN_EDGE_TTL,
  stale-while-revalidate=…` (other static, default 1 day at the edge, 1 h in browsers), `no-store` for HTML and `sw.js`.
- `/api/*` is `no-store` (never cached). Cache rules: bypass `/api/*`, `/media/pf-*` (paid), `/api/stream`, `/api/ws`; cache everything else by
  origin headers. Enable Brotli, HTTP/3, Tiered Cache; WebSockets on.
- Media: `MEDIA_CDN_URL` (existing) points to an R2/S3 public bucket behind the same CDN.
- Origin region: keep the DB close to the app; the closest managed regions to the Gulf are me-central-1 (UAE) / me-south-1 (Bahrain)
  or eu-central. Multi-region writes are out of scope; add read replicas (`db.read`, Phase 3) per region first.

## Sharding readiness (no sharding today)
`server/lib/shard.js`: `shardOf(id, n)` (jump consistent hash — growing N→N+1 moves ~1/(N+1) keys), `shardForRow(table,row)` with the
fixed shard-key map (`users.id`, `posts.author`, `comments.post`, `reactions.user_id`, `follows.src`, `notifications.user_id`,
`messages.conv`, `media.owner`, `memberships.community`, …; global: `audit_log`, `job_leases`, `ai_plans`, `ledger_*`), `shardDsn(n)`.
With `SHARD_COUNT` unset everything is shard 0 = `DATABASE_URL`. Before sharding: route repos through `shardForRow`, keep cross-shard
reads (feeds, search) on the search index / fan-out tables, and keep the ledger global (double-entry needs one transaction).
