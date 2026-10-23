# «مجتمع كوين» (MJT) — stage 1: the in-app balance (v2.47.0)

> **What it is:** an in-app balance kept on Mujtama+'s own double-entry ledger.
> **What it is not:** a cryptocurrency. MJT stage 1 is **not on any blockchain** (no Ethereum, BNB, Polygon, Solana or any other
> chain) and it is **not a Pi Mainnet token**. It cannot be withdrawn, sold or exchanged for money. Every screen says so.
> Stage 2 (a test asset on the **Pi Testnet**, linked to this ledger) is only a plan: see [MJT-PI-TESTNET-PLAN.md](MJT-PI-TESTNET-PLAN.md).

| | |
|---|---|
| Name / symbol | «مجتمع كوين» / **MJT** (Mujtama Coin) |
| Precision | 7 decimals; stored as integers: **1 MJT = 10,000,000 units** (the same precision as a Pi/Stellar asset, so stage 2 maps 1:1) |
| Supply | no fixed supply in stage 1; issued only by contribution rewards, the points conversion and audited staff adjustments; hard ceiling 100,000,000 MJT |
| Conversion rate | **1 contribution point = 1 MJT** (fixed) |
| Code | `server/lib/mjt-ledger.js` (ledger), `server/services/mjt.js` (rules + routes), migration `061_mjt`, UI `mjt-ui.js` + `mjt.css` (lazy chunk `mjt`) |

## 1. Ledger rules (enforced in `lib/mjt-ledger.js`, tested by property + concurrency tests)

1. **Integer minor units only.** Amounts typed by people are decimal **strings** parsed digit by digit (`parseAmount`); a JSON
   number with float noise (`0.1 + 0.2`) or an exponent (`1e-7`) is rejected; more than 7 decimals is rejected.
2. **Double entry.** A transaction is ≥ 2 signed lines on distinct accounts that sum to exactly 0.
3. **Idempotency.** Every mutation has a key; `mjt_tx.ikey` is UNIQUE. Re-posting a key returns the first transaction
   (`replayed: true`); the same key with a different request → `409 idempotency_conflict`. Transfers and staff adjustments need
   a client key (`ikey`, 8–80 of `[A-Za-z0-9_-]`); the wallet screen makes one per attempt so a double tap or a retried network
   request is answered once.
4. **No negative balance, no double spend.** Balances change only through
   `UPDATE … SET balance = balance + δ WHERE id = ? AND (allow_negative = 1 OR balance + δ >= 0)` inside the same DB
   transaction as the entries; zero rows → the whole transaction rolls back. A `CHECK (allow_negative = 1 OR balance >= 0)` on
   `mjt_accounts` is the second line of defence. On PostgreSQL user accounts are row-locked (`FOR UPDATE`) **users first,
   sorted, then system accounts, sorted** — the same order everywhere, so concurrent transactions cannot deadlock.
5. **Balance is derived and verified.** `mjt_accounts.balance` is a cache of `SUM(mjt_entries.amount)`; every entry also stores
   `balance_after`. `verify()` (admin screen, `GET /api/admin/mjt/verify`, `node server/scripts/mjt-convert.js --verify`)
   re-derives everything: cached = derived per account, every transaction sums to 0, no orphan/empty transactions, no negative
   balance, last entry = balance, Σ all balances = 0, supply = minted − burned = Σ users + treasury.
6. **Accounts.** `user:<id>` (≥ 0) · `sys:mint` (the only account allowed below 0: minus everything ever issued) · `sys:burn`
   (everything destroyed) · `sys:treasury` (MJT the platform received). Circulating = −mint − burn.
7. **Audit.** Every transaction writes `mjt_audit` in the same DB transaction; staff actions (adjust, freeze, conversion apply /
   rollback, settings) also go to the hash-chained `audit_log`.

## 2. Converting contribution points (phase 59) — rate 1 point = 1 MJT

Counted per member from `points_awards` created **before the MJT launch time** (`mjt_settings.launch`, written once on the first
boot of v2.47.0):

```
earned    = active awards of the earning kinds (answer_accepted, engaged_post, report_confirmed, wiki_edit, mentoring)
penalties = active NEGATIVE staff point adjustments
redeemed  = points in points → Pi redemptions that are pending or paid (already turned into value once)
MJT       = max(0, earned + penalties − redeemed) × 1
```

- **Not converted:** reversed awards (removed content) and *positive* staff point adjustments — the phase 59 rule "admin
  adjustments never become value" carries over.
- **Non-destructive:** the points tables are never written. Points stay as reputation, levels and the leaderboard. Each converted
  award gets a row in `mjt_point_links`, each member one in `mjt_conversions` (`batch_id`), the run one in
  `mjt_conversion_batches` with its report.
- **Idempotent:** at most one *applied* conversion per member (partial unique index) and at most one live link per award
  (partial unique index): running it twice converts nobody twice; parallel runs apply once.
- **One DB transaction per run** — all members or none.
- **Dry run:** `GET /api/admin/mjt/conversion/dry-run`, the «تجربة بلا كتابة» button, or
  `node server/scripts/mjt-convert.js --dry-run [--details]` — the same plan, nothing written.
- **Rollback:** `POST /api/admin/mjt/conversion/:batch/rollback` (`{ "dryRun": true }` to check first) or
  `node server/scripts/mjt-convert.js --rollback <batch> [--dry-run]`. Reverses every conversion of the batch with
  `conversion_reversal` transactions (sys:mint ← user), marks links/conversions/batch `rolled_back`. **All or nothing:** if any
  member has already spent part of the converted MJT, it refuses (`409 rollback_blocked`) and lists who. MJT already clawed back
  for removed content is subtracted. After a rollback, automatic conversion stays off until an admin applies again.
- **Schema rollback:** migration `061_mjt` `down` drops only the `mjt_*` tables (nothing else changes; tested on a realistic copy).
- **Production:** the conversion runs once automatically a few seconds after boot (`MJT_AUTO_CONVERT=0` turns that off). Its
  result is public in totals at `GET /api/mjt/supply` (`conversion.users`, `conversion.mjt`).

## 3. Earning (rewards)

Every **new** points award of an earning kind (after the launch) mints the same number of MJT — the phase 59 anti-gaming rules
(trust score, account age, linked accounts, integrity flags, cooldowns, per-kind caps, 150 points/day) still decide whether a
point is awarded at all. On top of that:

- **MJT daily cap** per member (default 150 MJT, UTC day); the last reward of the day is cut to what is left, later ones are
  recorded as `capped` and never paid later.
- **Rewards off** switch: awards made while it is off are recorded as `skipped` and never paid later.
- **Removed content** (points award reversed) → the MJT minted for it is **clawed back** (burned) up to the member's balance;
  never below 0; a shortfall is logged (`clawback_shortfall`).
- A **reconcile job** (every 15 min) pays awards whose hook failed and claws back reversals it missed.
- Minors (< 18) earn MJT but cannot transfer it. Frozen wallets earn nothing.
- While MJT is linked, the old **points → Pi redemption is retired** (`409 redemption_retired`), so no point is paid twice.

## 4. Transfers between members

`POST /api/mjt/transfers {to, amount, note?, ikey}` — final, no fee.

| Rule | Default |
|---|---|
| per transfer | ≤ 500 MJT |
| per UTC day (sent) | ≤ 2,000 MJT |
| per hour | ≤ 10 transfers |
| sender account age | ≥ 7 days |

Refused: minors (sender or recipient), blocked pairs, linked accounts (same device), integrity-flagged senders, frozen wallets,
recipients who switched receiving off (`PUT /api/mjt/receive`), self-transfers, transfers while switched off. Limits are checked
under the sender's row lock, so parallel requests cannot exceed them.

## 5. Staff

- **Adjust** (admins): `POST /api/admin/mjt/adjust {handle, amount (±), reason ≥ 5 chars, ikey}` — positive mints, negative
  burns and can never take a balance below 0; ≤ 10,000 MJT per adjustment; audited; the member is notified.
- **Freeze / unfreeze** (admins, with a reason): a frozen wallet cannot send or spend, still receives.
- **Settings** (admins): rewards on/off + daily cap; transfers on/off + limits.
- **Overview + verify** (staff): `GET /api/admin/mjt`, `GET /api/admin/mjt/verify`. Screen: `#/admin/mjt`.

## 6. Disabled in stage 1 and why

- **Buying MJT with Pi** — `POST /api/mjt/buy` answers **501 not_configured** («شراء مجتمع كوين بـ Pi غير متاح الآن — مدفوعات
  Pi غير مفعّلة بعد»). Pi payments are off in production (`PI_ENABLED`/`PI_API_KEY` unset); even with Pi on, buying MJT is a later
  stage.
- **Spending in the store / services** — no store or service accepted contribution points before v2.47.0, so there was nothing to
  re-wire. `spend()` / `refund()` (user → `sys:treasury` and back, idempotent) are tested internal primitives for that later stage.
- **Withdrawal / any blockchain** — none. Stage 2 is a Pi **Testnet** plan only.

## 7. Routes

| Method | Path | Who |
|---|---|---|
| GET | `/api/mjt/config` | anyone — token, rate, earn rules, transfer limits, buy status |
| GET | `/api/mjt/supply` | anyone — minted / burned / circulating, holders, conversion totals |
| GET | `/api/mjt/me` | member — balance (+ verified flag), today's rewards and sends, conversion, can-send |
| GET | `/api/mjt/history?cursor=` | member — own entries (keyset) |
| POST | `/api/mjt/transfers` | member |
| PUT | `/api/mjt/receive` | member |
| POST | `/api/mjt/buy` | member — 501 in stage 1 |
| GET | `/api/admin/mjt`, `/api/admin/mjt/verify` | staff |
| PUT | `/api/admin/mjt/settings` | admin |
| POST | `/api/admin/mjt/adjust`, `/api/admin/mjt/accounts/:handle/freeze` | admin |
| GET | `/api/admin/mjt/conversion/dry-run` | admin |
| POST | `/api/admin/mjt/conversion`, `/api/admin/mjt/conversion/:id/rollback`, `/api/admin/mjt/reconcile` | admin |

Screens: `#/mjt` (السجل · طرق الكسب · إرسال), `#/admin/mjt`. Entry points: Settings → «المدفوعات والمحفظة» → «مجتمع كوين (MJT)»,
the points page. Notifications: `mjt_received`, `mjt_adjusted`.

## 8. Tests

- `server/test/mjt.test.js` — API (SQLite + PostgreSQL).
- `server/test/mjt-invariants.test.js` — property test (seeded random operation sequences incl. replays and over-balance
  attempts, checked against an independent model after every step) + concurrency (parallel spends, parallel replays of one
  transfer, opposite transfers, parallel rewards vs the cap, parallel conversions).
- `server/test/mjt-migration.test.js` — conversion + migration up/down/re-run on a realistic generated copy (demo seed + 160
  members, ~1,900 awards); on PostgreSQL also the repository's `verify-migrations --apply` check.
- `tests/unit/mjt-ledger.test.js`, `tests/e2e/mjt.e2e.test.js` (axe light + dark, 44 px, screenshots 390 light / 360 dark).
