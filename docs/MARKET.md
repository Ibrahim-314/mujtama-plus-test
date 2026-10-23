# السوق المجتمعي — Community marketplace (Phase 39)

Server: `server/services/market.js`, migration `server/migrations/022_market.js`, tests `server/test/market.test.js`.
Contract: `docs/integration/p39-contract.md`. Integration notes for the UI team: `docs/integration/p39.md`.

## Model

| Table | What | Notes |
|---|---|---|
| `market_listings` (`ml_…`) | products & services priced in Pi | `item_condition` column (= API `condition`), `images` TEXT JSON `[{id, alt}]`, `quantity` NULL = unlimited (services only) |
| `market_orders` (`mo_…`) | one purchase | `unit_price`/`total`/`fee` snapshot, `intent_id` (Pi intent), `conversation_id`, `tracking`, one timestamp per transition |
| `market_escrow` | one per paid order | `held → released | refunded | split`, `hold_journal`, `settle_journal` |
| `market_reviews` (`mr_…`) | one per completed order | buyer → seller, rating 1–5, text ≤ 1000, seller `reply` |
| `market_disputes` (`md_…`) | one unresolved per order | `open → seller_responded → resolved`, `resolution`, `buyer_amount` |
| `market_dispute_messages` (`mdm_…`) | dispute thread | role `buyer|seller|staff`, evidence media ids |

Amounts are BIGINT units of 1e-7 Pi (like tips / paid content); the API always speaks Pi (numbers, 7 decimals max).
Migration 022 is additive only (`node server/scripts/verify-migrations.js --static` clean).

## Lifecycle

```
POST /listings/:id/order ── reserves quantity, opens the order conversation, creates the Pi intent (purpose market)
   pending_payment ──(Pi complete callback)──► paid_held ──ship──► shipped ──deliver──► delivered ──confirm / auto──► completed
        │ cancel (buyer/seller) / Pi cancel / expiry                │ seller cancel → refunded            ▲
        ▼                                                           └──── dispute (any of paid_held/shipped/delivered) ──► disputed
    cancelled (quantity restored)                                              admin resolve: refund_buyer → refunded
                                                                                              release_seller | split → completed
```

* Payment effects only happen on the Pi service bus events (`PI_PAYMENT_COMPLETED / CANCELLED / REFUNDED`, purpose
  `market`), never on a client call. Every transition is a conditional `UPDATE … WHERE status IN (…)` so retries and
  replays are no-ops. A payment that completes after its order was cancelled re-opens it as `paid_held` (quantity
  re-reserved, clamped at 0); the seller can then cancel (refund) or fulfil it.
* `deliver` is allowed straight from `paid_held` (services, digital goods, pickup).
* Auto-release: leased scheduler job `market.release` (every `MARKET_RELEASE_INTERVAL_MS`, default 15 min) completes
  `delivered` orders older than `MARKET_AUTO_RELEASE_DAYS` (7) and releases their escrow; disputed orders are skipped.
  The same job cancels `pending_payment` orders older than `MARKET_PENDING_TTL_HOURS` (24) whose Pi intent never
  reached Pi (or was cancelled/failed) and restores their quantity.

## Escrow & ledger (lib/ledger.js, double entry)

| Event | Journal `kind` (source `market`, ref = order id) | Lines |
|---|---|---|
| payment completed | `market_hold` | Dr `user:<buyer>:pi_out` · Cr `escrow:market` (total) |
| confirm / auto / release_seller | `market_release` | Dr `escrow:market` (total) · Cr `seller:<seller>:earnings` (total − fee) · Cr `platform:fees` (fee) |
| seller cancel / refund_buyer / Pi refund | `market_refund` | Dr `escrow:market` · Cr `user:<buyer>:pi_out` |
| split | `market_split` | Dr `escrow:market` · Cr buyer (buyerAmount) · Cr seller (rest − fee on the rest) · Cr `platform:fees` |

Fee `MARKET_FEE_PCT` (default 0) is a percentage of what the seller receives. Journals have `creator_id = NULL`, so tips
earnings, the honour roll and the PPV dashboard are not affected; `GET /api/admin/ledger/check` covers them.
Each settlement is one transaction: conditional escrow state change + journal (ikey `market:<order>:<mode>`).
Pi never moves inside this server: refunds to the buyer are A2U payments the operator sends; `refund_buyer` and seller
cancellation record them with `pi.refund` (pi transaction → `refunded`). A **split** records the partial amounts in
escrow/ledger only (the Pi service has no partial refund) — the operator sends `buyerAmount` back manually.

## Validation & safety

* Minors (minors service): 403 `minor_restricted` on create/update listing and on order (as buyer, or when the seller is a minor).
* Blocks (either direction, prefs or `user_blocks`): 403 `blocked` on order, `buyReason:"blocked"` on the listing.
* Text: `Classifier.spam` like posts → 422 `spam`; then `automod.assess` → `hold`/`escalate` → 422 `listing_rejected`
  (with the Arabic explanation); `delay`/`allow` publish. Admins skip automod. `AUTOMOD_ENABLED=0` disables it.
* Images: 1–8, the seller's own `ready` image uploads, not attached to a paid post (`paid_media`).
* Price: 0.01 – `MARKET_MAX_PRICE` (1000) Pi, ≤ 7 decimals; order total ≤ `MARKET_MAX_PRICE`; qty 1 – `MARKET_MAX_QTY` (100).

## Search

Active listings (seller active) are indexed in `search_docs` as kind `listing` (`ptype` = category) via the search
service's newly exported `indexDoc` / `removeDoc`; any other status, erasure or sold-out removes the document.
`GET /api/search?type=listing&q=` and `GET /api/search/full?type=listing&q=` answer listing results; the normal
`GET /api/search?q=` also carries `listings` (≤ 6). `GET /api/market/listings?q=` uses the same index (`engineIds`).

## Compliance

Data map entries for all six tables (export + erasure). Orders, escrow and disputes are kept (financial, legal basis);
on erasure (`USER_ANONYMISED`) the service removes the user's listings (title «إعلان محذوف», description/images/location
cleared, unindexed), clears review texts / seller replies, dispute statements/evidence and dispute messages.

## Configuration

`MARKET_MAX_PRICE`, `MARKET_FEE_PCT`, `MARKET_AUTO_RELEASE_DAYS`, `MARKET_PENDING_TTL_HOURS`, `MARKET_MAX_QTY`,
`MARKET_JOBS` (0 disables the job), `MARKET_RELEASE_INTERVAL_MS`. If `PI_PURPOSES` is set explicitly in an environment,
add `market` to it. Pi payments off → everything reads, orders answer 409 `not_configured`.
