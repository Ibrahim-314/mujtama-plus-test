# الإعلانات الأخلاقية — Ethical ads (Phase 40)

Server: `server/services/ads.js` · migration `023_ads` · tests `server/test/ads.test.js` · contract `docs/integration/p40-contract.md` ·
UI notes `docs/integration/p40.md`.

## What it is
Self-serve **promoted posts**: an advertiser promotes one of their own public posts, targets it by explicit interests only, prepays a
budget in Pi, passes a pre-publication review, and sees aggregate, k-anonymous results. Viewers see a clear «مُروَّج» label, can ask
«لماذا أرى هذا الإعلان؟», hide an ad or an advertiser, and turn interest-based ads off.

## Lifecycle
```
draft ──submit──► (spam/automod) ──reject──► rejected ──edit+submit──► …
  │                    │allow
  │                    ▼
  │                in_review ──staff reject──► rejected
  │                    │staff approve
  │                    ▼
  └─fund (any time before approval)──► awaiting_funds ──Pi completed──► active ◄──resume── paused
                                                                         │ └──pause──────►┘
                                                    budget spent / end_at ▼
                                                                     completed
any state ──DELETE──► removed
```
* Funding can happen in `draft`, `in_review` or `awaiting_funds`; approval of a funded campaign goes straight to `active`.
* After approval only `name`, `dailyCap`, `endAt` and `freqCap` can change (no new review needed); post, targeting, objective and
  CPM need a new campaign (409 `invalid_state`). A funded budget cannot change.
* Completion: `ads.maintain` (leased scheduler job, every `ADS_JOB_INTERVAL_MS`, default 10 min) completes campaigns whose `end_at`
  passed; an impression that leaves less than one impression's price completes it immediately. `ad_completed` is sent once.

## Eligible posts (400 `post_invalid`)
Own post, `published`, not a story, `visibility='public'`, public account, not in a community, not marked sensitive and without
publisher content labels, not paid/locked (`paid_posts.state='active'` or `data.paid`). Minors cannot advertise (403 `minor_restricted`).

## Targeting without tracking (hard rules)
Allowed inputs, and nothing else (`targeting` with any other key → 400 `targeting_invalid`):

| input | source | when personalised ads are OFF |
|---|---|---|
| `topics[]` (≤ 10, from `GET /api/ads/topics`) | topics the viewer follows (`topic_follows kind='topic'`) or chose as interests (`prefs.interests`) | campaign not eligible |
| `languages[]` (ISO 639-1) | the viewer's UI language (`users.lang`) | still used (contextual) |
| `countries[]` (ISO 3166-1 alpha-2) | the country the viewer set on their profile (`users.country`), never IP geolocation | campaign not eligible |

Not used, ever: DMs, private posts, browsing outside topic follows, engagement history, device fingerprints, third-party pixels,
cross-site data, age/gender. Sensitive categories (health, religion, politics, sexuality, ethnicity and their Arabic/English aliases,
see `SENSITIVE` in the service) are refused with **400 `targeting_sensitive`** — both on create/PATCH and in `/api/ads/estimate`.
Ads are only shown to adults: minors (minors service) never get ads. Signed-out viewers would only get campaigns with no targeting at
all (`pick(null)`); today `/api/feed` requires sign-in, so this path is service-level only.

## Delivery
`services/ranking.js` → `feed()` calls `ads.inject(viewer, posts, {mode, cursor})` after the organic page is built:
* home modes only: `for`, `following`, `chrono`, `latest`, `discover` (never communities, lists, topic/tag pages, DMs or search);
* one ad **after** every `ADS_FEED_INTERVAL` (8) organic posts, counted globally from the cursor (so never the first item, and
  cursors stay organic — `nextCursor` is unchanged);
* distinct campaigns per page, highest CPM first; a campaign promoting a post that is already on the page is skipped;
* hard filters: status `active`, funded, `start_at ≤ now < end_at`, `spent < funded`, today's spend `< daily_cap`, targeting match,
  frequency cap, viewer's hidden ads and hidden advertisers, blocks in either direction (`prefs.blocked` + `user_blocks`), muted
  accounts, own campaigns, advertiser account active, post still visible to the viewer (`content.filterVisible`).

## Frequency caps & privacy of delivery data
* Key: `HMAC-SHA256(daily salt, userId + ":" + campaignId)` (40 hex). Salts are random 32-byte values stored in `ad_meta` as
  `salt:YYYY-MM-DD` (UTC) and deleted by `ads.maintain` once older than yesterday — after that a hash can no longer be linked to anyone.
  Consequence: a frequency window never spans a UTC day change (caps are `perHours ≤ 24`; a new day starts a fresh counter).
* `ad_freq(hash, campaign_id, count, window_start, expires_at)` and `ad_tokens(hash, campaign_id, expires_at)` are purged after
  `ADS_FREQ_RETENTION_DAYS` (7).
* `ad_stats_daily(campaign_id, day, impressions, clicks, spend)` and `ad_feedback(campaign_id, reason, day, count)` are pure
  aggregates. None of these four tables has a user column; the tests scan every stored value for every user id.
* Feed tokens: `base64url(JSON{c, h, d, n, e}).sig` (HMAC-SHA256 with `ADS_TOKEN_SECRET` or a generated key in `ad_meta`), bound to
  the campaign, the viewer hash (or `anon`), and valid 24 h. Each token counts once per event type (`ad_tokens` = SHA-256 of the
  nonce + type).
* Advertiser-facing counts below `ADS_K_ANON` (10) are returned as `null` with the text «أقل من 10»; CTR is `null` then too.
  The audience estimate is bucketed (`أقل من 10`, `10–100`, `100–1,000`, …) and excludes minors and opted-out users when topics or
  countries are targeted.

## Money
* Amounts are BIGINT units of 1e-7 Pi like 020–022. Budget: `ADS_MIN_BUDGET`–`ADS_MAX_BUDGET` (1–1000), also bounded by
  `PI_MAX_AMOUNT` at funding. CPM bid: `ADS_MIN_CPM`–`ADS_MAX_CPM` (0.01–100, default 0.5). Price per impression = `round(bid_cpm/1000)`
  units, never more than what is left. Clicks are free (pure CPM for every objective).
* Funding: `POST /fund` → Pi intent (purpose `ads`, `refId` = campaign id, amount = budget). On `PI_PAYMENT_COMPLETED` (amount must
  match): journal `ads_fund` `user:<id>:pi_out` → `ads:budget:<cid>`; `awaiting_funds` → `active`. Cancelled intent → can fund again.
* Spend: each counted impression adds to `ad_campaigns.spent` and `ad_stats_daily.spend` in one transaction (conditional on
  `status='active' AND spent+price ≤ funded_amount`). `flushCharges` journals the delta `ads:budget:<cid>` → `platform:ads`
  (`ads_charge`, ikey `ads:<cid>:charge:<cumulativeSpent>`, idempotent) on pause, completion, removal and every `ads.maintain` run.
* `ad_budget_low` once when spend reaches `ADS_BUDGET_LOW_PCT` (80 %) of the funded budget.
* Unspent budget of a completed/removed campaign stays in `ads:budget:<cid>`; returning it is an operator A2U payment (as for market
  refunds). When staff record the Pi refund (`PI_PAYMENT_REFUNDED`), the campaign is removed and an `ads_refund` journal moves the
  unspent part back to `user:<id>:pi_out`.
* Pi off (production today): campaigns can be created, submitted and approved; they wait in `awaiting_funds`; `fund` → 409
  `not_configured` and campaign objects carry `fundNote: «مدفوعات Pi غير مفعّلة بعد»`.

## Review
Submit runs `Classifier.spam` and `automod.assess` (unless `AUTOMOD_ENABLED=0`) over the campaign name + post title/text/doc.
`hold`/`escalate`/spam → campaign `rejected`, an `ad_reviews` row with reviewer `automod`, notification `ad_rejected`, and
**422 `ad_rejected`**. Otherwise `in_review` (the automod verdict is shown to reviewers). Staff (`role` admin or moderator) decide in
`GET /api/admin/ads/review` → `POST /api/admin/ads/review/:id {decision, reasons, note}`; reasons: `misleading, prohibited,
sensitive, quality, guidelines, other` (required for reject). Every decision is audited (`AD_APPROVED`, `AD_REJECTED`, `AD_REJECTED_AUTOMOD`).

## Notifications (notify-lib)
`ad_approved`, `ad_rejected`, `ad_budget_low`, `ad_completed` — tab `system`, `ref` = campaign id, href `/#/ads/campaigns/:id`.

## Compliance
Data map: `ad_prefs` (personalization, exported, **deleted** on erasure), `ad_campaigns` (own campaigns exported; on erasure the
service scrubs `name`/`targeting`/notes and removes the campaign, financial figures kept), `ad_reviews` (reviewer's own decisions,
kept). System register: `ad_stats_daily`, `ad_feedback`, `ad_freq / ad_tokens` (no personal data). Ledger journals are
append-only financial records (`ledger_journals` entry mentions ads).

## Configuration
See `.env.example` → "Phase 40". `ADS_ENABLED=0` stops feed insertion; `ADS_JOBS=0` disables `ads.maintain` on an instance
(the job is leased, so one instance runs it at a time).
