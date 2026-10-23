# مكافحة الحسابات الوهمية — Integrity (Track 7, Phase 32)

Service: `server/services/integrity.js` · graph library: `server/lib/graph.js` · migration: `015_integrity` · client: `integrity-ui.js`.

**Principle.** Every detector is a heuristic that **ranks accounts for human review**. Nothing in this phase deletes an
account, a post or a follow, and nothing suspends anyone automatically. The only automatic actions are reversible:
a *soft limit* (lower action rates) and *soft-hiding* follows from public counts. Every staff decision and every
automatic change is written to the tamper-evident audit log.

## 1. Coordinated networks (`scanNetworks`, job `integrityScan`, every 30 min)
Builds a weighted *co-ordination graph* over the last 24 h:

| signal | how | edge weight |
|---|---|---|
| content | posts + comments normalised (Arabic diacritics/hamza/ta-marbuta/elongation, links, mentions, digits stripped), 64-bit **SimHash** on word bigrams; near-duplicates = Hamming ≤ 3 (found with 4×16-bit band buckets); a group needs ≥ 3 distinct authors | 2 per shared group |
| timing | "bursts": ≥ 4 distinct accounts acting on the same target (follow / reaction / comment) within 120 s. One burst is normal (a viral post); the same **pair** in ≥ 2 bursts becomes an edge | number of shared bursts |
| device | same device id (strong), or same coarse fingerprint **and** the same network fingerprint from `known_devices` (weak) | 3 / 1 |

Connected components over edges with weight ≥ 2 and ≥ 3 accounts become `network` flags. Score = `1 − Π(1 − sₖ)`
with s_content = min(0.8, 0.25·groups), s_timing = min(0.7, 0.04·timing weight), s_device scaled by size; < 0.3 is dropped.
Re-scans update the open case; a growing group extends its open case instead of opening a new one; dismissed cases are not re-raised for the same members.

## 2. Device fingerprint (`POST /api/integrity/device`)
The browser computes `SHA-256("fp|" + coarse traits)` (UA without version numbers, languages, time zone, screen
size/depth, DPR, cores, memory, platform, touch points — **no canvas/audio/font probing**) and `SHA-256("did|" + random id in localStorage)`,
at most once a day per account. The server stores only `HMAC-SHA256(salt, hash)` (salt = `INTEGRITY_SALT` or a random
value generated once in `integrity_meta`). When more than `DEVICE_MAX_ACCOUNTS` (default 5, matching the 5-account
switcher) accounts share a device, a `multi_account` case opens and the accounts beyond the oldest five get a
`limited` soft limit. Verifying a phone number lifts that automatic limit. Clearing localStorage defeats the device id; the
coarse fingerprint alone is never enough to link accounts (it must also share the network fingerprint).

## 3. Optional phone verification
`POST /api/integrity/phone/start {phone}` → 6-digit code, valid 10 min, 5 attempts, 3 sends / 10 min per account and
5 / hour per number. Numbers are normalised to E.164 (local `05…` → `+9665…`, Arabic-Indic digits accepted) and stored only
as HMAC + the last two digits for display. One number verifies at most `PHONE_MAX_ACCOUNTS` (default 1) accounts.
`POST /phone/verify {code}`, `DELETE /phone` (the member can remove it any time).

Delivery (`SMS_PROVIDER`): unset → `log` outside production (code goes to the in-memory **test sink**
`services.integrity.smsOutbox` and the dev log, never to a phone) and `off` in production (501, the UI says it is unavailable);
`webhook` → `POST SMS_WEBHOOK_URL {to, text}` with optional `Authorization: Bearer SMS_WEBHOOK_TOKEN` (e.g. a self-hosted
Android SMS gateway; zero cost). The code is never returned by the API.

## 4. Pi KYC as a trust signal
`POST /api/integrity/pi-kyc {accessToken}` — only when `PI_ENABLED=1` (otherwise 501; the UI hides the section).
The token is re-checked server-side with `GET {PI_API_URL}/v2/me`; the uid must equal the account's `pi_uid`. Pi does not
publicly document a KYC field, so `kyc_verified` / `kycVerified` / `kyc.status|verified` / `credentials.kyc` are accepted as
"verified"; anything else counts as **linked** (weaker signal). Accounts created through Pi sign-in are recorded as linked automatically.

## 5. Relationship graph (`lib/graph.js`)
Undirected weighted graph of follow + reaction + comment edges (last 90 days) for a bounded node set (≤ 400).
Deterministic label propagation (votes damped by the voter's degree so a single bridge cannot merge two groups),
directed density, reciprocity and conductance. `suspiciousClusters`: size ≥ 4, density ≥ 0.5, conductance ≤ 0.35;
score = 0.5·density + 0.25·reciprocity + 0.25·(1−conductance) (+ size bonus). The `integrityScan` job also scans accounts
created or following in the last 30 days and opens `cluster` cases at score ≥ 0.6. Staff see each account's neighbourhood graph.

## 6. Fake-follower cleanup (job `fakeFollowerCleanup`, every 6 h)
Candidates: recent followers, limited/suspended accounts, members of open/confirmed cases (score ≥ 0.6).
Score (0..1): new < 7 days +0.2 · no posts/comments +0.25 · no avatar +0.1 · no bio +0.05 · follows ≥ 100 with < 10 % follow-back
+0.25 · follows ≥ 500 +0.1 · soft-limited +0.3 · in a case +0.3 · verified phone −0.4 · Pi KYC −0.4; suspended = 1, verified badge = 0.
At ≥ `FAKE_FOLLOWER_THRESHOLD` (0.7) all of the account's follows get a `follower_flags` row with status `hidden`; the `follows` rows
are untouched. New follows by such an account are hidden on `USER_FOLLOWED`. When the score drops the job restores
(`restored_by='system'`); a **staff restore is sticky** (the job never re-hides it). `visibleFollowerCount(uid)` is what public
counts should show (see INTEGRATION.md). Members see how many of their followers are hidden in their trust center.

## 7. «حساب جديد» badge
`GET /api/integrity/badges?ids=a,b` or `?handle=x` (public, cached 60 s): `{newAccount, ageDays, joinedAt, signals: ["phone","pi"]}`.
Every account younger than `NEW_ACCOUNT_DAYS` (30) gets the badge — it is transparent and neutral (the explanation sheet says
it does not mean the account broke any rule). Shown on profiles by `integrity-ui.js`.

## 8. Investigations dashboard (admin only)
UI: `#/investigations` (KPIs, review queue by status, manual scan + cleanup, account lookup), `#/investigation/<id>` (evidence,
graph, decision with note), `#/inv-user/<handle>` (trust signals, accounts on the same device, neighbourhood graph,
suspicious clusters, cases, limit control), `#/inv-user/followers` (hidden followers with restore). Member page: `#/integrity`.

| API | |
|---|---|
| `GET /api/integrity/me` | own signals: age, phone, Pi, 2FA, limit (text only), hidden followers, trust score |
| `POST /api/integrity/device` · `POST /phone/start` · `POST /phone/verify` · `DELETE /phone` · `POST /pi-kyc` · `GET /badges` | member |
| `GET /api/admin/integrity/overview` · `GET /flags?status=` · `GET /flags/:id` · `POST /flags/:id {decision: confirm\|dismiss\|reopen, note}` | staff |
| `GET /api/admin/integrity/users/:idOrHandle` · `POST /users/:id/limit {level: none\|limited\|restricted}` | staff |
| `GET /api/admin/integrity/followers?user=` · `POST /followers/restore {src, dst?}` · `POST /scan {days}` · `POST /cleanup` | staff |

*Confirm* puts every member under the `restricted` soft limit (it never suspends — use the existing admin tools after review);
*dismiss* lifts the limits that case created. Soft limits per hour — limited: follow 20, post 6, comment 15, message 15, react 60;
restricted: 5 / 2 / 5 / 5 / 20 — enforced by `services.integrity.guard(userId, action)` (429 `integrity_limited`, Arabic message).

## Environment
`INTEGRITY_SALT` (secret, optional) · `NEW_ACCOUNT_DAYS`=30 · `DEVICE_MAX_ACCOUNTS`=5 · `PHONE_MAX_ACCOUNTS`=1 · `PHONE_DEFAULT_CC`=966 ·
`SMS_PROVIDER`=log\|webhook\|off · `SMS_WEBHOOK_URL` · `SMS_WEBHOOK_TOKEN` (secret) · `FAKE_FOLLOWER_THRESHOLD`=0.7 ·
`INTEGRITY_SCAN_MS`=1800000 · `FAKE_FOLLOWER_CLEANUP_MS`=21600000 · existing `PI_ENABLED`, `PI_API_URL`.

## Known limits
Heuristics only; thresholds are untuned guesses until there is labelled data. Carrier-grade NAT makes the network
fingerprint weak, so it is never used alone. Device ids are trivially reset by clearing storage. Scans are bounded
(3 000 texts, 20 000 events per type, 400 graph nodes) to stay cheap on a single instance.
