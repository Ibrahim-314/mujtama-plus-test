# Phase 41 — Real translation «الترجمة الحقيقية» — shared contract (server ⇄ UI ⇄ strings)

Base: commit 434b1f4 (v2.13.0). Migration **024_ai_translate** (additive only). Version bump to **2.14.0** at integration only.
Lazy chunks: **`i18n`** (`i18n-ui.js`: engine, language switcher, LTR/RTL, admin string manager — loads idle for everyone, early
when the saved language is not Arabic), **`i18n-en` / `i18n-fr` / `i18n-ur`** (`i18n/en.js`, `i18n/fr.js`, `i18n/ur.js`: string
catalogues, loaded only for that language), **`ai`** (`ai-ui.js`: translate buttons, toggle, auto-translate, upsell, subscription,
usage, admin AI). Core bundle stays ≤ 90 KB Brotli: no catalogue or AI code in core.

## Business model (user decision 2026-10-16)
- FREE for everyone: full UI in ar / en / fr / ur, UI string management, LTR + RTL, language switcher.
- PAID (optional monthly subscription in Pi, Pi purpose **`ai`**): machine translation of posts, comments and messages into the
  user's language, tap to toggle original ⇄ translation, auto-translate, shared translation cache, monthly usage / cost caps.
  Non-subscribers get an upsell sheet on the translate button.
- Generic, extensible AI entitlement system: a **plan** bundles **feature keys** (`translate` now; `assistant` in Phase 42, more later).
  Plan «مجتمع+ ذكاء» (slug `ai_plus`, features `["translate"]`). Price is NEVER hard-coded: `AI_PLAN_PRICE` env seeds it, admin edits
  it (`price_set_by=admin` wins over env). No price → subscribing answers 409 `price_unset`.
- Production today: no provider key, Pi payments off → translate answers 503 `not_configured` «خدمة الترجمة غير مفعّلة بعد»,
  subscribe answers 409 `not_configured` «مدفوعات Pi غير مفعّلة بعد». Everything else (UI languages) works.
- Minors (existing rules): cannot buy (403 `minor_restricted`, «الاشتراكات المدفوعة غير متاحة لمن هم دون ١٨ سنة»). Staff grants allowed.

## Privacy rules (hard)
- Providers are pluggable, configured ONLY by env keys: `AI_TRANSLATE_PROVIDER` = `openai` (OPENAI_API_KEY, OPENAI_BASE_URL,
  TRANSLATE_MODEL) | `deepl` (DEEPL_API_KEY) | `libre` (TRANSLATE_URL [+ TRANSLATE_KEY]); unset → first configured of deepl, openai, libre.
- A provider is **private** when it is keyed (API key) or explicitly self-hosted (`TRANSLATE_PRIVATE=1`). **Messages are never sent to
  a non-private provider** (409 `provider_not_private`). Public posts / comments may use any configured provider.
- E2EE messages: the server never sees ciphertext plaintext; the client may send the decrypted text it shows (`text`) with
  `consent:true` after a clear disclosure. That text is never cached, logged or stored. Missing → 409 `e2ee_plaintext_required`.
- Cache: `translations_cache` keyed by `sha256(scope + "\n" + normalised text)` + target. Scope `""` (shared) only for public posts /
  comments outside communities; `p:<postId>` for non-public posts; `m:<convId>` for non-E2EE messages (purged on delete and after
  `AI_MESSAGE_CACHE_DAYS`=30); paid posts and E2EE text are never cached. Originals are never overwritten.

## Data (024_ai_translate)
`ai_plans` (id, slug UNIQUE, name, features JSON, price BIGINT 1e-7 Pi | NULL, price_set_by, period_days, limits JSON, active),
`ai_subscriptions` (id, user_id, plan_id, state active|expired|revoked, source pi|grant, period_start, period_end, cancel_at_period_end,
cancelled_at, granted_by, grant_note, reminded_for, UNIQUE(user_id, plan_id)), `ai_payments` (id, user_id, plan_id, subscription_id,
amount, intent_id UNIQUE, status pending|completed|cancelled|refunded, period_start, period_end, period `YYYY-MM`),
`ai_usage` (user_id, period, feature, requests, chars, cache_hits, cost_micros — PK user/period/feature),
`ai_period_stats` (period, feature, provider, requests, chars, cache_hits, cost_micros — no user ids), `translations_cache`,
`translate_prefs` (user_id, auto, target, skip JSON), `ui_strings` (key, lang, text, updated_by — admin overrides),
`ui_string_misses` (lang, key, count, last_seen — no user ids).
Ledger: payment completed → journal `user:<id>:pi_out` → `platform:ai` (source `ai`, kind `ai_subscription`, ikey `ai:pay:<id>`);
refund → reversing journal. Provider cost in micro-USD per period in `ai_period_stats` → operator margin.

## API (JSON, session cookie, `X-Requested-With: mujtama` on writes; errors `{error (Arabic), code, requestId}`)
### AI entitlements (free to read)
- `GET /api/ai/config` → `{piEnabled, piNote?, currency:"PI", plans:[Plan], features:{translate:{available, provider|null, private, note?}},
  languages:["ar","en","fr","ur"], disclosure:{messages, e2ee}, label:"ترجمة آلية"}`
  **Plan** `{slug, name, features:[key], price:number|null, priceNote?, periodDays, limits:{translate:{chars, costUsd}}, active}`
- `GET /api/ai/me` (auth) → `{subscription: Sub|null, entitlements:{translate:boolean, assistant:boolean}, usage:{period, translate:{requests,
  chars, cacheHits, limitChars, pct}}, prefs: Prefs, minor:boolean, piEnabled}`
  **Sub** `{plan:{slug,name}, state, source, periodStart, periodEnd, cancelAtPeriodEnd, renewable, daysLeft}`
- `POST /api/ai/subscribe {plan?="ai_plus"}` → `{intent:{id, amount, memo, metadata:{intentId}}, plan}` (pass `intent` to `MPPi.pay`,
  purpose `ai` inside; renewing extends from the current end). Errors 403 `minor_restricted`, 404 `plan_not_found`, 409 `not_configured`
  (Pi off) | `price_unset` | `plan_inactive` | `pi_not_linked`, 429.
- `POST /api/ai/subscription/cancel {plan?}` / `…/resume` → `{subscription}` (cancel = no renewal, access to period end, no refund).
- `GET /api/ai/translate/prefs` / `PUT {auto?:boolean, target?: lang|null, skip?:[lang]}` → Prefs `{auto, target|null, skip}`.
### Translation (subscribers)
- `POST /api/ai/translate {kind:"post"|"comment"|"message", id, target?, text? (E2EE only), consent?}` →
  `{kind, id, text, source, target, cached, same?, provider, ai:true, label:"ترجمة آلية"}` (`same:true` → source already in target, free).
  Errors 400 `bad_request` | `lang_unsupported`, 401, 402 **`subscription_required`** (+ `upsell:{plan}`), 404, 409 `e2ee_plaintext_required` |
  `provider_not_private`, 429 `usage_limit` | `rate_limited`, 503 **`not_configured`** «خدمة الترجمة غير مفعّلة بعد» | `budget_exhausted` | `provider_error`.
- `POST /api/ai/translate/batch {items:[{kind,id}] ≤ 25, target?}` → `{target, items:[{kind,id,ok,text?,source?,cached?,same?,code?,error?}]}`
  (one 402/503 for the whole batch; per-item codes otherwise).
- Legacy `POST /api/translate {post, target}` now goes through the same entitlement (`text`-only calls → 400).
### i18n (free)
- `GET /api/i18n/config` → `{languages:[{code,name,dir}], default:"ar", fallback:"ar", versions:{lang:version}}`
- `GET /api/i18n/strings?lang=xx` → `{lang, version, strings:{key:text}}` (admin overrides; bundled catalogues live in the chunks).
- `GET/PUT /api/me/lang {lang}` → `{lang, dir}` (stored in `users.lang`).
- `POST /api/i18n/missing {lang, keys:[≤50]}` → `{ok}` (aggregated, no user ids).
- Admin (role admin): `GET /api/admin/i18n/strings?lang&q` → `{items:[{key,lang,text,updatedAt,updatedBy}]}`, `PUT /api/admin/i18n/strings
  {key ≤300, lang, text ≤1000}`, `DELETE /api/admin/i18n/strings {key, lang}`, `GET /api/admin/i18n/missing?lang` → `{items:[{key,count,lastSeen}]}`.
### Admin AI (role admin)
- `GET /api/admin/ai/plans`, `PUT /api/admin/ai/plans/:slug {name?, price? (number|null), active?, limits?, periodDays?}` → `{plan}`.
- `POST /api/admin/ai/grants {user (id|handle), plan?, days 1–366, note?}` → `{subscription}`; `POST /api/admin/ai/grants/revoke {user, plan?}`.
- `GET /api/admin/ai/subscribers?state` → `{items:[Sub + user]}`.
- `GET /api/admin/ai/finance?period=YYYY-MM` → `{period, currency, revenue, refunds, net, payments, activeSubscribers, grants,
  providerCostUsd, byFeature:[{feature, provider, requests, chars, cacheHits, costUsd}], piUsdRate|null, marginUsd|null, months:[…6]}`.
### Notifications
`ai_subscribed`, `ai_renew_reminder` (3 days before end, once per period, not when cancelled), `ai_expired` → href `/#/ai`.

## UI
- Language switcher: `#/settings/language` + the 🌐 language block in Settings (4 languages, names in their own language, dir).
  Choosing a language: `DB.settings.lang` + `PUT /api/me/lang`, `<html lang dir>`, loads `i18n-<lang>` and re-renders. LTR + RTL via
  logical CSS properties; Urdu RTL, French/English LTR.
- DOM translator in the `i18n` chunk: Arabic source strings (text nodes, `title`, `placeholder`, `aria-label`) → catalogue → admin
  overrides; MutationObserver for dynamic screens; user content (`.body`, `.cbody`, `.cm-b span[dir=auto]`, inputs) never touched.
  Misses are batched to `/api/i18n/missing`. Admin manager `#/admin/i18n`.
- `ai` chunk: «🌐 ترجمة» on posts / comments / messages whose language differs from the UI language; subscriber → translate, then tap
  toggles «عرض الأصل» ⇄ «عرض الترجمة», label «ترجمة آلية»; auto-translate for subscribers (`prefs.auto`, batch for visible items);
  non-subscriber → upsell sheet (plan, price or «لم يُحدَّد السعر بعد», feature list, `features.translate.note`, subscribe →
  `MPPi.pay` or «مدفوعات Pi غير مفعّلة بعد»). E2EE message → disclosure sheet then `{text, consent:true}`. `#/ai` subscription + usage
  page, `#/settings/translate` prefs, `#/admin/ai` (plans/price, grants, finance). Strict CSP: no inline handlers, no `javascript:`.
