# Tips & creator support (phase 37, v2.10.0)

Server: `server/services/tips.js` · migration `server/migrations/020_tips.js` · tests `server/test/tips.test.js` (stubbed Pi API).
Built on the Pi service (`docs/PI.md`): this service never calls the Pi API and holds no Pi logic of its own.

## How a payment flows
1. Client asks this service for an intent: `POST /api/tips/intent` (purpose `tip`, refId = post id, or the creator's user id
   for a profile tip) or `POST /api/support/intent` (purpose `subscription`, refId = creator user id).
   The service validates the rules below, then calls `ctx.services.pi.createIntent` and stores a `pending` tip / support month.
2. Client runs the normal Pi flow with the returned intent (`Pi.createPayment` → `/api/pi/payments/approve` → `/complete`).
3. Business effects happen only on bus events from the Pi service:
   - `PI_PAYMENT_COMPLETED` → tip `completed` (or `held`), support month `completed`, journal posted, notification sent.
   - `PI_PAYMENT_CANCELLED` → pending tip / month `cancelled` (also when the Pi reconciliation expires a stale intent).
   - `PI_PAYMENT_REFUNDED` (staff refund via `POST /api/admin/pi/payments/:id/refund`) → reversing journal; tip `refunded`;
     a refunded support month ends the support where that month began (state `cancelled`).
   Every effect is a conditional status update plus a journal with a unique idempotency key in one DB transaction, so a replayed
   or concurrent event never credits twice.

## Rules
- **Creators opt in** (`creator_settings.enabled`, default off). Up to 3 active tiers `{name ≤40, amount ≤ SUPPORT_MAX_AMOUNT, perks ≤500}`.
  Tiers left out of a `PUT` are retired (`active=0`), never deleted (supports keep a name/amount snapshot).
- **Minors** (minors service: declared band < 18) can neither enable creator mode, send, nor receive tips/support (403 `minor_restricted`).
  A minor never shows as an enabled creator. The minors service is looked up lazily (it registers last) and is optional.
- **No self-tips** (400 `self_tip`), **no tips to/from blocked users** in either direction (`user_blocks` or legacy `prefs.blocked`; 403 `blocked`),
  creator must be enabled (409 `creator_disabled`), post must be published and authored by the creator.
- **Fraud limits** (env, defaults): single tip ≤ `TIPS_MAX_SINGLE`=100 Pi (400 `tip_max`); ≤ `TIPS_MAX_DAILY`=500 Pi per sender per rolling
  24 h, tips + support months not cancelled/rejected (429 `tip_daily_limit`); accounts younger than `TIPS_NEW_ACCOUNT_DAYS`=3 days ≤
  `TIPS_NEW_ACCOUNT_DAILY`=10 Pi/day; ≤ `TIPS_MAX_PER_HOUR`=20 tips per hour (429 `tip_hourly_limit`).
- **Held for review**: a tip is marked at intent time and lands in `held` when paid if: ≥ `TIPS_VELOCITY_COUNT`=5 tips by the sender in the last
  `TIPS_VELOCITY_WINDOW_MIN`=10 minutes (`velocity`), amount ≥ `TIPS_HOLD_AMOUNT` (off by default, `amount`), or the sender has an
  integrity soft limit (`integrity_limited`). Held money sits in `platform:held`; an `integrity_flags` row (`kind='tip_velocity'`) is
  opened when that table exists. Staff: release → creator credited + notified; reject → hold reversed and the Pi transaction is
  recorded as refunded through the Pi service (`refundRecorded`; the Pi itself is sent back by the operator outside the app, as for every Pi refund).
- **Monthly support**: one row per (supporter, creator). Each month is a separate Pi payment. Period = `SUPPORT_PERIOD_DAYS`=30 days.
  A renewal paid while `active` (or `cancelled` but still within the paid period, or within grace) continues from the old `active_until`
  (no gap, no overlap); after a lapse a new period starts at payment time. Renewal reminder `SUPPORT_REMIND_DAYS`=3 days before
  `active_until` (once per period), `lapsed` after `SUPPORT_GRACE_DAYS`=3 days. The supporter may change tier when renewing.
  An intent while the support is `active` and not yet due → 409 `support_active`.
  Cancel anytime: state `cancelled`, perks stay until `active_until`, no reminders, no lapse event. No refund for the current month
  unless within 24 h of payment and staff refund it (`refundEligible` in the cancel response is informative only).
- `myStatus.state`: `none` (never paid) · `active` · `due` (within 3 days before `active_until` or in grace) · `lapsed` · `cancelled`.

## Double-entry ledger
Amounts are integer **units of 10⁻⁷ Pi** (BIGINT) — exact sums on SQLite and PostgreSQL; the API returns Pi numbers.
Accounts: `user:<id>:pi_out`, `creator:<id>:earnings`, `platform:fees`, `platform:held`. Balances are derived (no balance column).

| journal kind | lines (A = amount, F = floor(A·CREATOR_FEE_BPS/10000)) |
|---|---|
| `tip`, `support` | D `user:S:pi_out` A · C `creator:C:earnings` A−F · C `platform:fees` F |
| `tip_hold` | D `user:S:pi_out` A · C `platform:held` A |
| `tip_release` | D `platform:held` A · C `creator:C:earnings` A−F · C `platform:fees` F |
| `reversal` | the original's lines with debit and credit swapped; `reverses` = original journal id |

Zero lines are dropped; every journal has ≥ 2 lines and Σdebit = Σcredit (checked before insert). `ikey` (unique) makes posting
idempotent (`tip:<id>:credit|hold|release`, `support:<payment>:credit`, `rev:<journal>`). Nothing updates or deletes ledger rows.
`GET /api/admin/ledger/check` → `{journals, balanced, imbalances:[{journalId, kind, lines, debit, credit}], totals:{debit, credit}, checkedAt}`
(flags unbalanced/one-line/negative journals, orphan entries, journals reversed twice).

## API (session cookie + `X-Requested-With: mujtama` on non-GET)
- `GET /api/creators/:handle/support` (public) → `{creator:{id,handle,name,avatar,enabled}, tiers:[{id,name,amount,perks}],
  stats:{supporters, tipsCount}, myStatus:{tier|null, activeUntil|null, state, supportId?}, wall:[{user|null, amount|null, kind:"tip"|"support", at}]}`
  (wall = 20 most recent non-reversed contributions; `@handle` accepted).
- `GET /api/me/creator` → `{enabled, showAmounts, tiers, feeBps, limits:{maxTierAmount, maxTiers}}`; `PUT /api/me/creator {enabled?, showAmounts?, tiers?}` → same.
- `POST /api/tips/intent {toHandle, amount, postId?, message? ≤280, anonymous?, showAmount?}` → `{intent:{id,amount,memo,metadata}, tipId}`.
- `POST /api/support/intent {toHandle, tierId, anonymous?, showAmount?}` → `{intent, supportId, paymentId}`; `POST /api/support/:id/cancel`
  → `{ok, id, state, activeUntil, refundEligible, note}`.
- `GET /api/me/supporting` → `{items:[{id, creator:{handle,name,avatar}, tier, state, activeUntil, startedAt, lastPaidAt, cancelledAt, anonymous}]}`.
- `GET /api/posts/:id/tips` (public) → `{count, total|null, recent:[{user|null, amount|null, at, message?}]}` (10 most recent; `message` only for the author).
- `GET /api/creators/:handle/wall?period=month|all` (public; month = current UTC calendar month) →
  `{creator, period, items:[{rank, user|null, amount|null, count, kinds}]}` top 50 by amount net of refunds.
- `GET /api/me/earnings?period=day|week|month` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 1 year, UTC days) →
  `{currency:"Pi", period, from, to, gross, fees, net, refunds, series:[{date,gross,net}], bySource:{tips,support}, topPosts:[{postId,total}],
  topSupporters:[{user|null, anonymous, total, count}], csvUrl}`. `net = gross − fees − refunds`; refunds are net amounts taken back.
  Held tips count when released. `GET /api/me/earnings.csv?…` same range, one row per journal (BOM, CSV-injection safe).
- `GET /api/me/ledger?cursor=&limit=` (1–100, default 50) → `{entries:[{id, journalId, kind, source, refId, reverses, account:"pi_out"|"earnings", debit, credit, amount, at}], nextCursor}`.
- Admin: `GET /api/admin/tips/held`, `POST /api/admin/tips/:id/release {note?}`, `POST /api/admin/tips/:id/reject {note?, txid?}`, `GET /api/admin/ledger/check`.

## Visibility
- `anonymous` hides the supporter's identity everywhere (wall, honour roll, post summary, creator's notifications, earnings, CSV),
  including from the creator. Staff see it in the held queue.
- An amount is public only when the creator set `showAmounts` **and** the supporter sent it with `showAmount:true` (default false).
  On the honour roll a supporter's total is shown only if all of their contributions allowed it. The post total is public when the
  creator shows amounts; the author always sees totals in their own views.

## Events & notifications
Bus: `TIP_RECEIVED {tip, creator, sender|null, anonymous, amount, postId}`, `SUPPORT_STARTED|SUPPORT_RENEWED {support, payment, creator,
supporter|null, anonymous, tierId, amount, activeUntil}`, `SUPPORT_LAPSED {support, creator, supporter}`.
Notification kinds (notify-lib): `tip` («أرسل لك <name> إكرامية»), `tip_anon`, `support_started`, `support_renewed`, `support_anon`
(to the creator), `support_due`, `support_lapsed` (to the supporter; `ref` = creator handle).

## Jobs
`ctx.scheduler.every("tips.support", TIPS_JOB_INTERVAL_MS=1h, supportJob)` — leased (one instance at a time); reminders + lapses.
`TIPS_JOBS=0` disables it. Pending intents that are never paid are expired by the Pi reconciliation (`PI_INTENT_TTL_HOURS`) → `cancelled` here.

## Compliance
Data map: `creator_settings`, `creator_tiers` (service, deleted on erasure); `tips` (sent), `support_subscriptions`, `support_payments`,
`ledger_entries` (legal, kept); `ledger_journals` is a system record. On `USER_ANONYMISED` the service clears the messages of tips the
person sent; financial rows stay.
