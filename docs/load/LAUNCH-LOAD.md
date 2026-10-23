# Launch load test — 10,000 concurrent (phase 50)

**Status:** script ready, **not yet run at 10k**. A real 10k run needs a staging copy sized like production plus an external
load generator. That is not available here, and production must never be the target.

## Scripts
- `tools/k6-launch.js`: the 10k-VU scenario. Ramps 0→2k→6k→10k, holds 5 min, ramps down. Mix: health, launch config, personalised feed,
  help-center search (30 %), 2 % posts; 2–4 s think time (≈3,000 req/s at 10k VUs). Thresholds: errors <1 %, feed p95 <800 ms,
  help p95 <300 ms, health p95 <150 ms. Refuses production-looking hosts unless `I_AM_ON_STAGING=1`.
  `k6 run -e BASE=https://staging… -e HANDLES=load_1,… -e PASSWORD=… tools/k6-launch.js`
- `tools/load-launch.mjs`: scaled-down local run with autocannon. Spawns a local server (SQLite file + demo seed) on 127.0.0.1
  and refuses any non-loopback BASE.

## Local run (2026-10-16, this sandbox: 2 vCPU, 8 GB, Node 22, single process, SQLite, closed loop, no think time)
`STEPS=100,300,800 DURATION=8 node tools/load-launch.mjs`

| connections | req/s | p50 ms | p97.5 ms | p99 ms | max ms | requests | non-2xx | errors |
|---|---|---|---|---|---|---|---|---|
| 100 | 2,373 | 39 | 91 | 104 | 133 | 18,984 | 0 | 0 |
| 300 | 2,513 | 104 | 194 | 219 | 7,408 | 20,102 | 0 | 0 |
| 800 | 2,432 | 193 | 446 | 574 | 7,993 | 19,452 | 0 | 0 |

What this shows: one process tops out at about 2.4–2.5k req/s on this mix. Throughput is CPU-bound and flat, and latency grows with queue depth.
There were no errors up to 800 connections. 800 is near the sandbox's 1,024 file-descriptor limit, so higher counts were not attempted.
The feed for a single test account is partly cached, so real per-user feeds will cost more.

What it does not show: anything about 10k concurrent *users*. 10k users with 2–4 s think time ≈ 3k req/s, which is above one
process on this hardware. Plan for ≥2–3 web instances on PostgreSQL + Redis-backed rate limits/realtime (see the phase 48 scale work), then
confirm with `tools/k6-launch.js` on staging before opening registration (`LAUNCH_MODE=invite` until then is the safe lever).
