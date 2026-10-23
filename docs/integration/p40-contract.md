# Phase 40 — Ethical ads (الإعلانات الأخلاقية) — shared contract (server ⇄ UI)

Base: commit be4ca54 (v2.12.0). Migration **023_ads** (additive only). Version bump to 2.13.0 at integration only.
Builds on: Pi payments (purpose `ads`, budget prepaid in Pi via intent → `MPPi.pay`; Pi is OFF in prod, so campaigns can be created/reviewed but not funded: state `awaiting_funds`, UI note «مدفوعات Pi غير مفعّلة بعد»), ledger (`server/lib/ledger.js`, account `ads:budget:<campaignId>` → `platform:ads` as impressions/clicks are charged), ranking service (feed insertion), automod/safety, minors (minors never see ads and cannot advertise → 403 `minor_restricted`), notify-lib, compliance data map, topics/interests.

## Parts
1. Promoted posts with a clear label «مُروَّج»  2. Interest-based targeting, no tracking  3. Frequency caps
4. Self-serve campaign manager  5. Ad data separated from personal data  6. Pre-publication review
7. Campaign dashboard with metrics  8. «لماذا أرى هذا الإعلان؟»

## Privacy model (part 2 & 5 — hard rules)
- Targeting inputs allowed ONLY: topics/interests the viewer explicitly follows or chose, language, country (coarse, from profile setting, never IP geolocation), age band adult-only. No cross-site tracking, no third-party pixels, no device fingerprinting, no use of DMs, private posts, browsing history outside topic follows, or sensitive categories (health, religion, politics, sexuality, ethnicity) — such topics cannot be targeted (400 `targeting_sensitive`).
- Ad delivery/metrics tables store NO user ids: impressions/clicks are aggregated per campaign per day; frequency caps use a per-viewer salted hash (`HMAC(ADS_SALT_daily_rotating, userId+campaignId)`) in a TTL table purged after 7 days. Advertisers see only aggregates with k-anonymity (counts < 10 shown as «أقل من 10»).
- Users can turn off interest-based ads (`GET/PUT /api/me/ads/prefs {personalized:boolean, hiddenAdvertisers:[]}`) → contextual/untargeted only; "hide this ad" and "hide this advertiser".

## Data (023_ads)
`ad_campaigns` (id `ac_…`, advertiser_id, post_id (promoted existing own public post, not paid/locked, not in a minors context), name, objective `reach|engagement|visits`, targeting JSON {topics[], languages[], countries[]}, budget_total, daily_cap, bid_cpm, freq_cap {impressions, perHours} default 3/24h, start_at, end_at, status `draft|in_review|rejected|awaiting_funds|active|paused|completed|removed`, review_note, created/updated),
`ad_reviews` (campaign_id, reviewer, decision approve|reject, reasons[], note, at), `ad_stats_daily` (campaign_id, day, impressions, clicks, spend — no user ids), `ad_freq` (hash, campaign_id, count, window_start, expires_at), `ad_prefs` (user_id, personalized, hidden_advertisers JSON), `ad_feedback` (campaign_id, reason, day, count — aggregated, no user id).

## API
- Advertiser: `POST /api/ads/campaigns`, `PATCH /api/ads/campaigns/:id`, `POST /api/ads/campaigns/:id/{submit|pause|resume|fund}` (fund → `{intent}` when Pi on, else 409 `not_configured`), `DELETE` (→ removed), `GET /api/ads/campaigns`, `GET /api/ads/campaigns/:id` (+ `stats:{days:[{day,impressions,clicks,spend,ctr}], totals}`), `GET /api/ads/topics` (targetable topics, sensitive excluded), `POST /api/ads/estimate {targeting}` → audience size bucket (k-anon).
  Errors: 400 `campaign_invalid|targeting_invalid|targeting_sensitive|budget_invalid|post_invalid`, 403 `minor_restricted`, 409 `invalid_state|not_configured`, 422 `ad_rejected`.
- Review (admin/moderator): `GET /api/admin/ads/review`, `POST /api/admin/ads/review/:id {decision, reasons, note}`; submit runs automod first; approval → `awaiting_funds` (or `active` if funded); notifications `ad_approved, ad_rejected, ad_budget_low, ad_completed` → href `/#/ads/campaigns/:id`.
- Delivery: ranking/feed inserts at most 1 ad per 8 organic posts (`ADS_FEED_INTERVAL`), never first slot, never in communities/DMs/search for now, respecting freq caps, prefs, hidden advertisers, blocks/mutes. Feed items carry `promoted:{campaignId, label:"مُروَّج", advertiser:{handle,name}}`. `POST /api/ads/events {campaignId, type:"impression"|"click", token}` (token signed in the feed item, single-use per viewer hash) — aggregates only.
- Why: `GET /api/ads/why/:campaignId` → `{reasons:[{type:"topic",topic}|{type:"language"}|{type:"country"}|{type:"general"}], personalized:boolean, controls}`. `POST /api/ads/hide {campaignId, scope:"ad"|"advertiser", reason}`.

## UI (lazy chunk `ads`, `ads-ui.js`; strict CSP: no onclick, no javascript:)
- Promoted feed card: visible «مُروَّج» label + advertiser, ⋯ menu with «لماذا أرى هذا الإعلان؟» (sheet with reasons + link to ad prefs), «إخفاء الإعلان», «إخفاء هذا المعلن». Impression sent when ≥50% visible ≥1 s (IntersectionObserver), once.
- `#/ads` campaign manager list, `#/ads/new` & `#/ads/edit/:id` wizard (pick own post → targeting by topics/language/country with audience estimate → budget/daily cap/dates/freq cap → review & submit), `#/ads/campaigns/:id` dashboard (impressions, clicks, CTR, spend, daily chart via inline SVG, status, review note, pause/resume/fund), `#/settings/ads` prefs, `#/admin/ads/review` queue.
- Core bundle stays ≤ 90 KB Brotli.
