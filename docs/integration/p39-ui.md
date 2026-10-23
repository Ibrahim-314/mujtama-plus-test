# Phase 39 (Community marketplace «السوق المجتمعي») — client integration notes

Branch `p39-ui` (from b4dc8d9 / v2.11.0). Client only; written against `docs/integration/p39-contract.md` (copied into this branch),
with the market + Pi API stubbed in the e2e suite. No new dependency, no core CSS, no server change. Version stays 2.11.0 (bump to 2.12.0 at integration).

## Files
- **New** `market-ui.js` — lazy chunk `market` (≈ 76 KB raw / 20.0 KB br). Everything market lives here; styles injected (`#mk-css`).
- **New** `tests/e2e/market.e2e.test.js` — 15 tests (stubbed market + Pi + media API, real users/session/chunks, real CSP in the last test).
  `MK_SHOTS=/some/dir` optionally saves screenshots (grid mobile/900/1440, product, Pi off, order).
- `index.html` — one line after the paid chunk:
  ```html
  <script src="market-ui.js" data-chunk="market"></script>
  ```
- `chunks.js` (core) — `market: ["market"]` in `ROUTES`, and `#/admin/market/*` is mapped to the `market` chunk (the first segment
  `admin` belongs to `pi`). The two copies of the "which chunk does this hash need" logic were merged into `needFor()`, so the core
  bundle got **smaller**: 91,500 B br (was 91,575 B at b4dc8d9; budget 92,160 B).
- `discovery-ui.js` (chunk) — «🛍️ السوق» link (`#mk-ex`) added to the explore shortcuts row (`content_shortcuts`). Zero core bytes.
- **No change** to `sw.js` (listing images are public `/media/` URLs; the P38 private/no-store rule still applies), `ui.js`, theme or nav markup.

## Routes (all inside the chunk, via `window.ExtraRoutes`)
| Hash | Screen | API |
|---|---|---|
| `#/market` | grid: search (debounced 350 ms + submit), category chips (`aria-pressed`), filters (kind, condition, min/max, sort), infinite scroll (IntersectionObserver + «عرض المزيد» button), 2/3/4 columns via container queries; on ≥1180 px the body gets `mk-wide` (column 976 px, rail hidden) | `GET /api/market/listings?q&category&kind&condition&min&max&sort&cursor` |
| `#/market/item/:id` | gallery (thumbnails, ←/→/Home/End, swipe, lightbox with Esc + focus trap, lazy images, alt = `alt` or «العنوان — صورة n من m»), price/tags, buy box, description, seller card (stars, sales) | `GET /api/market/listings/:id` |
| `#/market/new`, `#/market/edit/:id` | form: kind, title 3–120, description ≤ 5000, price 0.01–`marketMaxPrice` (7 decimals), category, condition (hidden for services → `na`), quantity (int ≥ 0; empty service = `null`), delivery, location, 1–8 images (upload, reorder, remove), «نشر» / «حفظ كمسودة»; edit adds pause/resume + delete | `POST /api/media` (existing), `POST/PATCH/DELETE /api/market/listings[/:id]` |
| `#/market/orders` | tabs مشترياتي / مبيعاتي / إعلاناتي (ARIA tabs, arrow keys) | `GET /api/me/market/orders?role=buyer|seller`, `GET /api/me/market/listings` |
| `#/market/orders/:id` | stepper + timeline, escrow card, role actions, «محادثة الطلب» → `#/chat/:conversationId`, review form (buyer, completed), dispute sheet (reason, text, ≤ 4 evidence images), dispute panel + messages | `GET /api/market/orders/:id`, `POST …/{ship,deliver,confirm,cancel,review,dispute}`, `GET /api/market/disputes/:id`, `POST …/messages` |
| `#/market/seller/:handle` | rating summary (+ distribution if sent), reviews with seller replies, «تقييمات أقدم» (`?cursor=`), reply form on your own page | `GET /api/market/sellers/:handle`, `POST /api/market/reviews/:id/reply` |
| `#/admin/market/disputes` | admin queue (open + seller_responded), evidence, resolve refund/release/split (split: `0 < buyerAmount < total`); card `#mk-adm` on `#/admin` | `GET /api/admin/market/disputes`, `POST …/:id/resolve {resolution, buyerAmount?}` |

`window.MPMarket = { grid, item, form, orders, order, seller, admin, lightbox, filters, version:"2.12.0" }`.

## Buy flow
`POST /api/market/listings/:id/order {qty}` runs **inside** `MPPi.pay({ purpose:"market", refId, intent })`'s intent callback (after Pi
auth / incomplete-payment flush), so the returned `intent` reaches `Pi.createPayment` unchanged (`amount, memo, metadata`); approve /
complete are the existing `/api/pi/payments/*`. On success → `#/market/orders/:orderId` (also when completion failed after paying: `e.paid`).
Pi off: `/api/pi/config.enabled === false` **or** `buyReason:"not_configured"` → button disabled + «مدفوعات Pi غير مفعّلة بعد»; no request is sent.
Other `buyReason`s: `sign_in`, `own_listing` (shows «تعديل الإعلان» instead), `minor_restricted`, `sold_out` → disabled + Arabic reason.
409 `not_configured` from the order endpoint is shown in Arabic and disables the pay button.

## What the integrator must know (assumptions about shapes the contract leaves open)
- Lists accept `{items}` (also `listings` / `orders` / `reviews` / `disputes`); single objects accept a wrapper (`{listing}`, `{order}`, `{dispute}`) or the bare object.
- **ListingCard**: `{id,title,price,kind,condition,status,seller:{handle,rating:{avg,count}}, image|cover|images[0]}` where an image is `{url,thumb?,alt?,w?,h?}` or a URL string.
- **Order**: `buyer{id,handle}`/`seller{id,handle}` (or `buyerId`/`sellerId`), `qty, unitPrice, total, status, conversationId, escrow{state,amount,buyerAmount?,sellerAmount?}, timeline[{status|event, at, note?}]`,
  optional `role`, `review`, `dispute{id}` or `disputeId`, `autoReleaseAt`. If the server sends `actions:[…]` the UI uses it verbatim; otherwise it derives:
  seller `paid_held → ship, deliver, cancel`, `shipped → deliver`, `pending_payment → cancel`; buyer `shipped|delivered → confirm`, `pending_payment → cancel`,
  `paid_held|shipped|delivered → dispute` (if none), `completed → review` (if none). The server stays the authority (errors are shown in Arabic).
- **Grid `condition`** is sent as a query param (not in the contract list); the client also filters the page by `condition` so it works either way.
  Please accept `condition=` in `GET /api/market/listings` to keep pagination exact.
- `/api/pi/config.marketMaxPrice` (optional) drives the form's max price; default 1000 (`MARKET_MAX_PRICE`).
- Media: listing images are uploaded with the existing `POST /api/media` → `{media:{id,url,thumb?}}`; the form sends `images:[ids]` in display order (first = cover).
- Error codes mapped in Arabic: `listing_invalid, price_invalid, images_invalid, category_invalid, minor_restricted, spam, not_configured, sold_out, own_listing,
  sign_in, qty_invalid, invalid_state/order_state, review_exists, dispute_exists, forbidden, not_found`; an Arabic `error` message from the server wins.
  `price_invalid / images_invalid / category_invalid` are attached to their field; others go to the form error summary.
- Seller page: `{seller|profile:{id,handle,name,avatar,rating:{avg,count,distribution?},sales}, reviews:[{id,rating,text,reply?,buyer,listing?,createdAt}], next, listings?}`.
- Admin dispute row: `{id, order:{id,total,listing:{title}}, buyer, seller, reason, text, evidence:[{id,url}], status, createdAt}`; resolved ones are hidden.
- Notifications: the contract's hrefs (`/#/market/orders/:id`, `/#/market/seller/:handle`) open the right screens; the chunk loads on demand from the hash.
- CSP: no inline handlers / `javascript:` URLs; retry buttons use `data-ui="route"`. Inline `style=""` attributes rely on the existing `style-src 'unsafe-inline'`.
- E2E harness note: the suite stubs every market endpoint; against the merged server, drop the market/pi stubs one by one (keep the fake `window.Pi`).

## Checks run on this branch
- `node --test tests/e2e/market.e2e.test.js` → 15/15 (run 4× after the last change: stable).
- Modified-file suites: `tests/e2e/discovery.e2e.test.js` 6/6, `tests/e2e/paid.e2e.test.js` 11/11 (chunk routing for pi/tips/paid/admin + CSP), `tests/unit/client.test.js` 6/6.
  The full old suite was **not** re-run (by request).
- `npm run build && npm run budget` → core JS 89.4 KB br / 90 KB, CSS 13.6 KB / 14 KB, `chunk-market` 20.0 KB.
- `npx eslint .` → 0 errors (warnings are pre-existing, none in the new files). `npm run typecheck` → passes.

## Integration (p39-integrate → v2.12.0)
- Seller page: `reviews` is `{items, next}` (pagination cursor in `reviews.next`); rating distribution is `seller.distribution`. Both shapes accepted.
- Admin dispute rows: flat `{title, total, orderId, evidence}` (no nested `order`); the client accepts both.
- Dispute messages: `role` is `buyer|seller|staff`; `staff` renders as «الإدارة».
- Max price: `GET /api/market/config.maxPrice` (fetched once per chunk load); `/api/pi/config.marketMaxPrice` still honoured if a server sends it.
- Extra Arabic error/buyReason texts: `listing_rejected, unavailable, insufficient_quantity, review_invalid, evidence_invalid, resolution_invalid, split_invalid, dispute_resolved, bad_request, unauthorized`.
- `order.actions` from the server is always present and used verbatim (client derivation stays as fallback).
- New e2e test «real P39 server» runs without market / media / Pi stubs: form create (real upload), `condition=` filter, Pi-off product page, seller reply, order page, admin dispute row.
- `MPMarket.version` / `MPPi.version` = 2.12.0.
