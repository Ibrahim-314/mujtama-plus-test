# AI subscriptions & real translation (Phase 41)

## What is free and what is paid
| Free for everyone | «مجتمع+ ذكاء» subscribers (monthly, in Pi) |
|---|---|
| Interface in العربية / English / Français / اردو, LTR + RTL, language switcher, UI string management | Machine translation of posts, comments and messages into the user's language, tap to toggle original ⇄ translation, auto-translate, monthly usage caps |

## Entitlements (generic, extensible)
- `ai_plans` bundle **feature keys**. Phase 41 ships `ai_plus` = `["translate"]`. Phase 42 adds `assistant` to a plan (admin `PUT /api/admin/ai/plans/:slug {features}`) and calls
  `ctx.services.ai.requireFeature(uid, "assistant")`, `checkCaps`, `meter` — nothing else changes.
- Price: never in code. `AI_PLAN_PRICE` seeds it; an admin price (`price_set_by=admin`) wins. No price → 409 `price_unset`.
- Period: one Pi payment (purpose `ai`) per `AI_PERIOD_DAYS` (30). Renewing early extends from the current end. Cancel stops renewal; access lasts to the end (no pro-rata refund).
  Staff refunds (Pi service) post the reversing journal and cut the refunded period. Staff grants give access without money (also to minors). Minors cannot buy.
- Ledger: `user:<id>:pi_out` → `platform:ai`. Operator view: `GET /api/admin/ai/finance?period=YYYY-MM` → revenue / refunds / net (Pi), provider cost (USD), cache hits, margin when `AI_PI_USD_RATE` is set.

## Translation
- Providers by env key only: DeepL (`DEEPL_API_KEY`), any OpenAI-compatible endpoint (`OPENAI_API_KEY`), LibreTranslate (`TRANSLATE_URL`). No key → 503 `not_configured` «خدمة الترجمة غير مفعّلة بعد».
- Cache `translations_cache`: `sha256(scope + "\n" + text)` + target. Shared scope only for public content outside communities, so one translation serves every subscriber. Cache hits are free and do not count against caps.
- Privacy: messages only to a private provider (keyed or `TRANSLATE_PRIVATE=1`); E2EE messages need the client's plaintext + `consent:true` and are never cached; disappearing chats are not cached; chat caches are purged on delete and after 30 days; paid posts only ever expose their public teaser and are not cached.
- Caps: per user per month (plan limits, defaults `AI_TRANSLATE_MONTHLY_CHARS`, `AI_TRANSLATE_MONTHLY_USD`) → 429 `usage_limit`; global `AI_PROVIDER_MONTHLY_USD` → 503 `budget_exhausted`.

## Production today
No provider key and Pi payments off: the four interface languages work; translate buttons open the upsell sheet with «خدمة الترجمة غير مفعّلة بعد»; subscribing shows «مدفوعات Pi غير مفعّلة بعد».
To turn on later (operator decision, may cost money): set a provider key, `AI_PLAN_PRICE` (or an admin price) and enable Pi payments.
