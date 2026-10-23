# Phase 38 (Subscriptions & paid content) — client integration notes

Branch `p38-ui` (from tag `v2.10.0`). Client only; aligned with `p38-server` dc98d44 (`docs/PAID.md`, `docs/integration/p38.md`).
No new dependency, no core CSS, core JS unchanged except the generated `__CHUNKS` map entry.

## Files
- **New** `paid-ui.js` — lazy chunk `paid` (≈ 9 KB br). Everything paid lives here, styles injected (`#pd-css`).
- **New** `tests/e2e/paid.e2e.test.js` — 11 tests (stubbed paid + Pi API, real users/posts, real CSP in the last test).
- `index.html` — one line after the tips chunk:
  ```html
  <script src="paid-ui.js" data-chunk="paid"></script>
  ```
- `tips-ui.js` (chunk) — loads the paid chunk at its end (`window.MPChunks?.load("paid")`) so pi → tips → paid always arrive in order;
  earnings source line gains `bySource.ppv` («من المحتوى المدفوع»).
- `sw.js` — `/media/` responses with `Cache-Control: private|no-store` are no longer put in the SW cache (paid media).
- **`chunks.js`: no change** (zero core bytes). The paid routes start with core segments (`me`, `admin`, `purchases`), the chunk
  re-routes deep links itself once loaded.

## What the chunk does
- Wraps `postInner`: a post with `locked:true` is rendered from a clone with only the teaser (`teaser ?? text`); `media/images/video/audio/
  poll/doc/quote` are dropped even if present. Below it: blurred placeholder from `lock.media` (count only, no URL) and a lock card —
  PPV: «افتح مقابل X Pi» (only when Pi on, `lock.purchasable !== false`, `reason !== "not_configured"`), supporters: min tier, `lock.tiers`,
  CTA → `#/support/:handle`. `reason:"minor_restricted"` → no CTA, Arabic note. Pi off → Arabic «غير مفعّلة بعد», teaser still shown.
  Unlocked paid posts get a small badge from `paid`. `hydrate` is wrapped so a locked post always has a string `text`.
- Unlock: `POST /api/paid/:postId/intent` → `intent` passed unchanged through `MPPi.pay` → `Pi.createPayment` → approve/complete →
  `GET /api/posts/:id` swapped into the store + background `/api/bootstrap`. `409 already_unlocked` = success. Errors mapped in Arabic
  (server Arabic message wins).
- Composer v3 (create only — composer3 never edits; legacy composer for polls/questions/events gets no paid UI): «الوصول إلى المنشور»
  fieldset in «خيارات النشر»: مجاني / للداعمين فقط (+ min tier select) / مدفوع مرة واحدة (price 0.01–`paidMaxPrice`|100, teaser ≤ 200).
  Hidden for stories; disabled when Pi off, creator not enabled, or (supporters) no tiers. The choice is added as `paid` to the composer's
  own `POST /api/posts` (a `Remote.api` wrapper armed by a capture click listener on «نشر»; invalid price blocks publishing).
- Routes: `#/me/purchases` and alias **`#/purchases`** (notification links), `#/me/paid-posts` (creator), `#/admin/paid` (refund queue,
  approve with optional `note` + `txid`, reject with `note`), card on `#/admin`, link card on `#/creator`, card in Settings.
- `window.MPPaid = { unlock, refresh, purchases, paidPosts, admin, version:"2.11.0" }`.

## For the integrator
- Notifications: `ppv_purchased` → post (server), buyer kinds → `/#/purchases` (works).
- Server must keep `text` = teaser on locked posts (never undefined) — it does (`🔒` when empty).
- E2E harness note: the suite rewrites real-server JSON (digest/explore/…) to strip the body because this branch's server has no paid
  feature; against the merged server that is a no-op.
