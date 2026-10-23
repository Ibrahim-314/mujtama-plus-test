# Phase 40 (Ethical ads «الإعلانات الأخلاقية») — client integration notes

Branch `p40-ui` (from be4ca54 / v2.12.0). Client only; written against `docs/integration/p40-contract.md` (copied into this branch),
with the ads + Pi API stubbed in the e2e suite (the feed itself is the real `/api/feed` with promoted items spliced in).
No new dependency, no core CSS, no server change. Version stays 2.12.0 (bump to 2.13.0 at integration; `MPAds.version`).

## Files
- **New** `ads-ui.js` — lazy chunk `ads` (≈ 57 KB raw / 16.4 KB br). Everything ads lives here; styles injected (`#ad-css`).
- **New** `tests/e2e/ads.e2e.test.js` — 10 tests (stubbed ads + Pi API, real users/posts/session/chunks/feed, real CSP in the last test).
  `AD_SHOTS=/some/dir` optionally saves screenshots (feed ad, why sheet, wizard targeting, dashboard).
- `index.html` — one line after the market chunk: `<script src="ads-ui.js" data-chunk="ads"></script>`.
- `chunks.js` (core, +≈ 40 B br) — `ads: ["ads"]` in `ROUTES`; `#/settings/ads` and `#/admin/ads/*` map to the `ads` chunk
  (first segments `settings` / `admin` belong to core / `pi`); the idle chain loads `ads` after `tips` (so the Settings card and
  promoted cards are ready). Core JS: **91,548 B br** (was 91,490 B at be4ca54; budget 92,160 B).
- `discovery-ui.js` (chunk, 0 core bytes) — the server-ranked feed **drops promoted items until the ads chunk is loaded**
  (an ad is never shown without its «مُروَّج» label); when a ranked response contains `promoted`, it loads `ads` and repaints
  through the existing `reorderIfNeeded` guard.
- **No change** to `sw.js`, `ui.js`, `feed.js`, theme or nav markup.

## Promoted feed card
- Source: `GET /api/feed` items with `promoted:{campaignId, label, advertiser:{handle,name}, token?}` (kept by discovery in
  `MPDiscovery.state().FD.ranked[mode].posts`). The chunk marks those post ids in the list Home renders (`Views.home` wraps
  `Feed.build` at call time, so it is outermost whatever chunk loaded last), shallow-clones the post with `promoted`
  (the store copy is never tagged, so the same post elsewhere is not labelled), keeps one card per campaign, and **moves an ad out
  of the first slot** if a client-side reorder (new-first) put it there.
- Card (`postCard` wrap): `.ad-card[data-ad=<campaignId>]`, `role="article"`, `aria-labelledby` → a visible strip
  «مُروَّج · من <advertiser>» (+ visually-hidden «، محتوى إعلاني»), so screen readers announce the label first. Amber border + pill.
- ⋯ (`data-ad-more`, `aria-haspopup="dialog"`, `aria-label="خيارات الإعلان: …"`) replaces the post menu on ad cards:
  «لماذا أرى هذا الإعلان؟» → `GET /api/ads/why/:campaignId` (reasons topic / language / country / general, `personalized:false`
  note, privacy statement, link `#/settings/ads`), «إخفاء الإعلان» / «إخفاء هذا المعلن» → reason (`not_interested | repetitive |
  misleading`) → `POST /api/ads/hide {campaignId, scope:"ad"|"advertiser", reason}`; cards disappear at once and stay hidden for the
  session (the server filters afterwards). Esc closes, focus returns to ⋯.
- Impression: `IntersectionObserver`; ≥ 50 % of the card (or ≥ half the viewport for very tall cards) visible for ≥ 1 s, tab visible →
  `POST /api/ads/events {campaignId, type:"impression", token}` **once per campaign + token** per page session.
- Click: a click inside the card (not reactions / share / save / ⋯) followed within 2.5 s by navigation to `#/post/…` or `#/u/…`
  → `{type:"click"}` once. Listeners sit on `window` (capture) because the core's open-post / double-tap handlers stop propagation.

## Routes (inside the chunk, via `window.ExtraRoutes`)
| Hash | Screen | API |
|---|---|---|
| `#/ads` (`#/ads/campaigns`) | list: name, status chip, objective, budget, dates, «تعديل» for draft/rejected, «＋ حملة جديدة» | `GET /api/ads/campaigns` |
| `#/ads/new`, `#/ads/edit/:id` | 4-step wizard (ARIA stepper, focus to the step legend, Arabic field errors with `aria-invalid`): 1 own eligible post (local store: own, public, published, not locked/paid, not a story/repost, not in a non-public community) + name (3–80) + objective `reach|engagement|visits`; 2 topics (chips `aria-pressed`) / languages / countries with a sticky live estimate (`aria-live`, debounced 400 ms); 3 budget (0.1–1000 Pi), daily cap (≤ budget), start/end dates, frequency cap (1–10 per 24/48/168 h); 4 review + inert feed preview → «حفظ كمسودة» or «إرسال للمراجعة». Edit only in `draft|rejected` (shows the previous review note). | `GET /api/ads/topics`, `POST /api/ads/estimate`, `POST /api/ads/campaigns` or `PATCH …/:id`, then `POST …/:id/submit` |
| `#/ads/campaigns/:id` | dashboard: status, dates, link to the post, review note + reasons, KPIs (impressions, clicks, CTR, spend), budget bar, inline-SVG daily chart (bars = impressions, line = clicks, RTL: oldest on the right, masked days grey) + visually-hidden data table, actions | `GET /api/ads/campaigns/:id`, `POST …/{submit,pause,resume,fund}`, `DELETE …/:id` (two-step confirm) |
| `#/settings/ads` | `role="switch"` «إعلانات حسب اهتماماتي», hidden advertisers with «إظهار», privacy explainer | `GET/PUT /api/me/ads/prefs` |
| `#/admin/ads/review` | queue: advertiser, post excerpt, targeting, budget, automod labels, reject reasons (checkboxes), note, approve/reject; card `#ad-adm` on `#/admin` | `GET /api/admin/ads/review`, `POST …/:id {decision, reasons, note}` |

Entry points: card `#ad-set` on `#/settings` («حملاتي الإعلانية» `#/ads`, «تفضيلات الإعلانات» `#/settings/ads`), `#ad-adm` on `#/admin`.
Notification hrefs `/#/ads/campaigns/:id` load the chunk from the hash.
`window.MPAds = { list, wizard, dashboard, prefs, review, why, mark, bucketText, kv, version }`.

## Funding (Pi)
`POST /api/ads/campaigns/:id/fund` runs **inside** `MPPi.pay({ purpose:"ads", refId:campaignId, amount:budgetTotal, intent })`'s intent
callback, so the returned `intent` (`{intent}` or the bare intent) reaches `Pi.createPayment` unchanged; approve/complete are the existing
`/api/pi/payments/*`; then the dashboard reloads. Pi off (`/api/pi/config.enabled === false`) → fund button disabled + «مدفوعات Pi غير
مفعّلة بعد…», no request. A 409 `not_configured` from the endpoint shows the same note and disables the button. Cancel → «لم يُخصم شيء».
Fund is offered for `awaiting_funds` and `paused`.

## What the integrator must know (shapes the contract leaves open)
- **Request bodies are camelCase**: `{postId, name, objective, targeting:{topics[],languages[],countries[]}, budgetTotal, dailyCap,
  startAt, endAt (ISO, local day start / end), freqCap:{impressions, perHours}}`. Responses: camelCase **or** snake_case
  (`post_id, budget_total, daily_cap, freq_cap{impressions,per_hours}, start_at, end_at, review_note, review_reasons`) are accepted,
  wrapped `{campaign}` or bare. Lists accept `{items}` or `{campaigns}`.
- Languages sent as ISO 639-1 (`ar,en,fr,ur,tr,id`), countries as ISO 3166-1 alpha-2 (24 codes, Arab countries first).
- Campaign detail: `stats:{days:[{day,impressions,clicks,spend,ctr}], totals:{impressions,clicks,spend,ctr}}` at the top level or inside
  the campaign. If `totals` has a key (even `null`) it wins over the client sum. `ctr` may be a ratio (≤ 1) or a percentage.
- **k-anonymity**: masked counts may be `null`, `"<10"`, `"lt10"`, `{lt:10}` or any object; the client also masks 1–9 itself
  → «أقل من 10». `0` is shown as ٠. CTR is «—» when either side is masked.
- Estimate: `{bucket}` / `{audience}` / `{estimate}` / `{size}` as a string (`"<10"` → «أقل من 10», anything else shown verbatim),
  a number (< 10 masked, else «≈ n»), or `{min,max,label?}` (Arabic `label` wins; `max < 10` masked).
- Topics: `{topics}` / `{items}` / array of `{slug|id, name}` or slugs.
- `actions:[…]` on a campaign is used verbatim (`edit, submit, pause, resume, fund, delete`); otherwise derived from status:
  draft → edit/submit/delete, rejected → edit/delete, awaiting_funds → fund/delete, active → pause, paused → resume/fund/delete.
- Feed token: read from `promoted.token`, else `item.adToken`, else `item.token`; sent as `token` (null if absent).
- Prefs: `hiddenAdvertisers` may be strings or `{id,handle,name}`; PUT sends the full object `{personalized, hiddenAdvertisers:[id|handle]}`.
- Review queue row: `{id, name, advertiser|owner:{handle,name}, post:{id,text}|postId, targeting, budgetTotal, startAt, endAt,
  automod|flags:{labels[]}|[], submittedAt}`. Reject reasons sent: `misleading, prohibited, sensitive, quality, rights, other`;
  the dashboard maps them back to Arabic (unknown codes shown raw). Approve sends `{decision:"approve", reasons:[], note}`.
- Error codes in Arabic: `campaign_invalid, targeting_invalid, targeting_sensitive, budget_invalid, post_invalid, minor_restricted,
  invalid_state, not_configured, ad_rejected, not_found, forbidden, unauthorized`; an Arabic `error` message from the server wins.
  On save: `post_invalid` → step 1, `targeting_*` → step 2, `budget_invalid` → step 3, others → review-step summary (draft id kept,
  so a retry PATCHes). 403 `minor_restricted` on `#/ads` shows the reason with no retry button.
- CSP: no inline handlers / `javascript:` URLs; cancel/retry/compose use `data-ui`. Inline `style=""` relies on the existing `style-src 'unsafe-inline'`.

## Checks run on this branch
- `node --test tests/e2e/ads.e2e.test.js` → 10/10 (3 consecutive runs).
- Modified-file suites: `tests/e2e/discovery.e2e.test.js` 6/6 (discovery-ui.js), `tests/e2e/paid.e2e.test.js` 11/11 and
  `tests/e2e/market.e2e.test.js` 16/16 (chunks.js routing incl. `#/admin/market`), `tests/unit/client.test.js` 6/6.
  The full old suite was **not** re-run (by request).
- `npm run build && npm run budget` → core JS 89.4 KB br / 90 KB (91,548 B), CSS 13.6 KB / 14 KB, `chunk-ads` 16.4 KB.
- `npx eslint .` → 0 errors (new files: 0 warnings). `npm run typecheck` → passes.

## Integration (p40-integrate → v2.13.0)
- Campaign: budget is read from the server's `budget:{total, dailyCap, spent, funded}` object (flat / snake_case still accepted);
  review reasons from `review.reasons` (automod `spam` shown as «محتوى مزعج (سبام)»); `piEnabled:false` / `fundNote` disable «تمويل».
- Request bodies stay camelCase (the server accepts them as sent). `startAt` is never in the past (today → now; the server refuses
  a start more than 10 min ago). Frequency window options 6 / 12 / 24 h (server caps `perHours` at 24, the UTC salt day);
  impressions 1–`freqCap.maxImpressions` (20). Budget min/max from `GET /api/ads/config` (fetched once per chunk load; defaults 1–1000).
- Stats: `ctr` from the server is a percentage (2 decimals); masked counts are `null` (+ `…Text`) → «أقل من 10». The dashboard also lists
  aggregated hide reasons (`stats.hides`, k-anonymous).
- Estimate: `{audience:{bucket,min,max,label}}` → the Arabic `label` is shown verbatim.
- Hide reasons sent: `irrelevant | repetitive | misleading | offensive` (server list). Reject reasons in the review queue come from the
  response's `reasons:[{code,label}]` (`guidelines` replaces the client's guessed `rights`); automod `reasons`/`explanations` shown.
- Why sheet: topic reasons use the server's `name`.
- Extra Arabic error texts: `review_invalid, event_invalid, token_invalid, bad_request, spam, rate_limited` (`forbidden`, `pi_not_linked` already present).
- `edit_limited` (awaiting_funds/active/paused) is not offered in the wizard yet (edit stays draft/rejected only).
- New e2e test «real P40 server» runs without ads / Pi stubs: wizard on own post → submit → admin approve → `awaiting_funds` with fund
  disabled (Pi off); a second advertiser's campaign funded through the ledger (`PI_PAYMENT_COMPLETED` event) appears in the real
  `/api/feed` after organic #8 and on Home with «مُروَّج»; real impression counted; why sheet; hide advertiser (prefs + aggregated feedback);
  no user id in `ad_stats_daily / ad_feedback / ad_freq / ad_tokens`.
- `MPAds.version` / `MPPi.version` = 2.13.0.
