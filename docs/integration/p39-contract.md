# Phase 39 — Community marketplace (السوق المجتمعي) — shared contract (server ⇄ UI)

Base: commit b4dc8d9 (v2.11.0). Migration **022_market** (additive only). Version bump to 2.12.0 happens at integration, not in team branches.
Builds on: Pi payments (docs/PI.md, `Pi.createPayment` via `MPPi.pay`, intents), ledger (`server/lib/ledger.js`), minors (minors cannot buy/sell → 403 `minor_restricted`),
chat/messaging (order conversation), search service, notify-lib, compliance data map, automod/safety (listing text goes through the same checks as posts).
Pi payments are OFF in production: everything must work and render with Pi off (buy button disabled with Arabic note «مدفوعات Pi غير مفعّلة بعد»).

## Parts
1. Listings of products & services priced in Pi  2. Seller ratings  3. Orders + purchase conversation  4. Escrow
5. Product search indexing  6. Disputes & resolution  7. Market grid UI  8. Product page with multiple images

## Data (022_market)
- `market_listings` id `ml_…`, seller_id, kind `product|service`, title (3–120), description (≤ 5000), price (Pi, 0.01–`MARKET_MAX_PRICE` default 1000, 7 decimals),
  currency `PI`, category (from fixed list: electronics, fashion, home, books, digital, services, education, crafts, other), condition `new|used|na`,
  quantity (int ≥0, services may be null = unlimited), images JSON (1–8 media ids, seller's own uploads), location text optional, delivery `pickup|shipping|digital|onsite`,
  status `draft|active|paused|sold_out|removed`, created_at, updated_at, views, community_id optional.
- `market_orders` id `mo_…`, listing_id, buyer_id, seller_id, qty, unit_price, total, status:
  `pending_payment → paid_held (escrow) → shipped/delivered (seller marks) → completed (buyer confirms or auto after MARKET_AUTO_RELEASE_DAYS=7 from delivered) | cancelled | refunded | disputed`
  chat conversation id, payment id/intent, timestamps per transition.
- `market_escrow` (one per order): held amount, state `held|released|refunded|split`, ledger journal ids. Funds go buyer → escrow account → seller on release (double-entry via lib/ledger.js, accounts `escrow:market`).
  Platform fee `MARKET_FEE_PCT` default 0.
- `market_reviews`: one per completed order (buyer → seller), rating 1–5, text ≤ 1000, seller reply optional; seller aggregate (avg, count) on `GET /api/market/sellers/:handle`.
- `market_disputes`: order_id, opened_by, reason `not_received|not_as_described|damaged|other`, text, evidence media ids, status `open|seller_responded|resolved`, resolution `refund_buyer|release_seller|split` (+ split amount), resolver (admin), messages.

## API (all JSON, session cookie, CSRF as existing)
- `GET /api/market/listings?q=&category=&kind=&min=&max=&sort=new|price_asc|price_desc|rating&cursor=` → `{items:[ListingCard], next}`
- `GET /api/market/listings/:id` → Listing (full, `images:[{id,url,thumb,w,h,alt}]`, seller `{id,handle,name,avatar,rating:{avg,count},sales}`, `canBuy`, `buyReason?` (`sign_in|own_listing|minor_restricted|not_configured|sold_out`))
- `POST /api/market/listings` / `PATCH /api/market/listings/:id` / `DELETE` (→ removed). Errors 400 `listing_invalid|price_invalid|images_invalid|category_invalid`, 403 `minor_restricted`, 422 `spam`.
- `GET /api/me/market/listings`, `GET /api/me/market/orders?role=buyer|seller`
- `POST /api/market/listings/:id/order {qty}` → `{order, intent}`; client passes `intent` unchanged to `MPPi.pay` (purpose `market`); Pi complete callback moves order to `paid_held`. Pi off → 409 `not_configured`.
- `POST /api/market/orders/:id/{ship|deliver|confirm|cancel}`; `GET /api/market/orders/:id` (buyer, seller, admin only) incl. `conversationId`, `escrow`, `timeline`.
- `POST /api/market/orders/:id/review {rating,text}`, `POST /api/market/reviews/:id/reply {text}`, `GET /api/market/sellers/:handle` (profile + reviews page).
- `POST /api/market/orders/:id/dispute {reason,text,evidence?}`, `GET /api/market/disputes/:id`, `POST /api/market/disputes/:id/messages`,
  admin: `GET /api/admin/market/disputes`, `POST /api/admin/market/disputes/:id/resolve {resolution, buyerAmount?}`.
- Order conversation: created on order through the existing chat service between buyer & seller, titled with the listing; system messages on each transition.
- Search: active listings indexed in the existing search service (type `listing`), removed/paused/sold_out excluded; `GET /api/search?type=listing` works.
- Notifications kinds: `market_order_new, market_order_paid, market_order_shipped, market_order_delivered, market_order_completed, market_review, market_dispute_opened, market_dispute_resolved` → href `/#/market/orders/:id` (review → `/#/market/seller/:handle`).

## UI routes (lazy chunk `market`, `market-ui.js`, zero/near-zero core bytes; CSP strict: no onclick, no javascript:)
`#/market` grid (search, category chips, filters, sort, infinite scroll, responsive 2/3/4 columns, RTL), `#/market/item/:id` product page with multi-image gallery
(swipe, thumbnails, keyboard, alt text, lightbox), seller card + rating, buy button / order flow, `#/market/new` & `#/market/edit/:id` listing form (up to 8 images, reorder),
`#/market/orders` (buyer/seller tabs), `#/market/orders/:id` (timeline, escrow state, actions, open chat, review, dispute), `#/market/seller/:handle`, `#/admin/market/disputes`.
Entry point: a «السوق» link in the existing nav/explore without growing the core bundle beyond the 90 KB Brotli budget.
