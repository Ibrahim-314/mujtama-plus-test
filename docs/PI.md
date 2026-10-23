# Pi Network integration (phase 36, v2.9.0; App Studio sign-in: phase 36b)

Server: `server/services/pi.js` · migration `server/migrations/019_pi.js` · tests `server/test/pi.test.js` (stubbed Pi API).
Client side (Pi SDK in the Pi Browser) is the UI team's lazy chunk; this file documents the server contract and rules.

## Safety rules
- **Payments off by default.** `PI_ENABLED=0` → every payment/wallet/receipt/admin `/api/pi/*` route answers
  `501 {error:"مدفوعات Pi غير مفعّلة بعد", code:"not_configured"}`. Payment routes also answer 501 when `PI_API_KEY` is empty.
- **Sign-in is separate (36b).** `PI_AUTH_ENABLED` (default **on** — it needs no API key) gates `POST /api/pi/auth`,
  `GET|DELETE /api/pi/link` and the legacy `POST /api/auth/pi`; `PI_AUTH_ENABLED=0` → those answer 501 `not_configured`.
  `GET /api/pi/config` is always public.
- **Testnet by default.** Mainnet only when `PI_NETWORK=mainnet` **and** `PI_MAINNET_CONFIRM=1`; with only the first flag the
  server stays on testnet and logs one warning (no secret in it). `sandbox` is `true` on testnet unless `PI_SANDBOX=0`, always `false` on mainnet.
- **Secrets.** The Server API Key (`PI_API_KEY` / `PI_API_KEY_FILE`) and user access tokens are only placed in `Authorization`
  headers to the Pi API. They are never logged, stored, returned, or echoed in error messages. Error logs carry the Pi path
  (payment id replaced by `:id`), method and HTTP status only.
- **Nothing from the client is trusted** beyond identifiers: the Pi uid/username come only from the server-side Pi App Studio
  login exchange (any `uid`/`username` in the request body, query or headers is ignored); amounts, owner, network,
  direction, cancellation and the txid all come from `GET /v2/payments/:id`.
- **App Studio exchange.** `POST PI_APPSTUDIO_URL {accessToken}` → `200 {sessionToken, user:{uid, username}}`, server-side only
  (the browser never calls it; its origin is not in the CSP). The `sessionToken` is discarded — never stored, logged or returned.
  The exchange happens once per token: a sha256 of the token is remembered in memory for 10 minutes so the
  `needsLink → link:true` (or «create account with Pi») follow-up does not exchange it again. Non-200 → `401 pi_invalid`
  (Arabic message); network error, timeout (10 s) or a 200 without `user.uid` → `502 pi_upstream`. Logs carry the HTTP status only.
- **No wallet seed, no app→user payments from this server.** Refunds are made by the operator outside the app and *recorded* here.

## Environment
| var | default | meaning |
|---|---|---|
| `PI_ENABLED` | `0` | payments master switch |
| `PI_AUTH_ENABLED` | `1` | Pi sign-in / linking (App Studio); `0` turns it off |
| `PI_APPSTUDIO_URL` | `https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login` | App Studio login endpoint (full URL, https only; anything else falls back to the default) |
| `CSP_FRAME_ANCESTORS_EXTRA` | – | extra explicit `https://` origins appended to CSP `frame-ancestors` (a bare `*` is ignored) |
| `PI_API_KEY` | – | Server API Key (Developer Portal). Secret |
| `PI_API_URL` | `https://api.minepi.com` | Pi Platform API base |
| `PI_NETWORK` | `testnet` | `testnet` \| `mainnet` (needs confirm) |
| `PI_MAINNET_CONFIRM` | `0` | must be `1` for mainnet |
| `PI_SANDBOX` | `1` on testnet | value returned by `/api/pi/config` (informational since 36b: the client calls `Pi.init({version:"2.0"})` with no sandbox option) |
| `PI_APP_ID` | – | optional, echoed by `/api/pi/config` |
| `PI_MAX_AMOUNT` | `1000` | max Pi per intent |
| `PI_PURPOSES` | `tip,donation,subscription,boost,purchase,event_ticket,ppv,market,ads,test` | allowed `purpose` values |
| `PI_INTENT_TTL_HOURS` | `24` | unpaid intents (never handed to Pi) are cancelled by the reconciliation |
| `PI_JOBS` | `1` | `0` disables the leased reconciliation job |
| `PI_RECONCILE_INTERVAL_MS` | `3600000` | how often the job checks whether yesterday was reconciled |
| `PI_EXPLORER_URL` | `https://blockexplorer.minepi.com` | receipts link to `{base}/{testnet|mainnet}/tx/{txid}` |

Tests/integration can inject everything through `config.piOpts = { env, fetch, now, jobs }` (as `createApp({ piOpts })`).

## Data model (019_pi, additive)
- `pi_links(user_id PK, pi_uid UNIQUE, pi_username, network, linked_at, last_auth_at)` — `users.pi_uid` is kept in sync
  (older services — integrity KYC, minors KYC signal — read it).
- `pi_transactions(id PK = intent id "pit_…", user_id, payment_id UNIQUE, pi_uid, amount, memo, purpose, ref_id, direction out|in,
  network, status, txid, meta, error, refund_of, created_at, updated_at, approved_at, completed_at, cancelled_at, refunded_at, reconciled_at)`.
- `pi_tx_events` — every status transition (`source`: client | incomplete | reconcile | admin).
- `pi_reconciliation` — one row per run (`kind`: job | admin), counts + `payload.mismatched`.
- Legacy `pi_payments` is not modified. At startup the service copies its rows into `pi_transactions` (`id = "pil_" + payment_id`,
  purpose `legacy`) and creates `pi_links` for users that already had `pi_uid` — idempotent `INSERT … ON CONFLICT DO NOTHING`.
  (Kept out of the migration so `verify-migrations --static` stays "purely additive".)

### Status machine
```
created ──approve──▶ approved ──complete (txid verified by Pi)──▶ completed ──admin refund──▶ refunded
   │                    │
   ├── cancel / Pi cancelled / intent expired ──▶ cancelled
   └── amount / owner mismatch ──▶ failed
```
Every transition is a conditional `UPDATE … WHERE status IN (…)`, so retries, double taps and concurrent callbacks are idempotent;
only the call that actually moved the row writes the event and emits the bus event.

## API (session cookie + `X-Requested-With: mujtama` on non-GET, like every route)
- `GET /api/pi/config` (public) → `{enabled (payments), authEnabled (sign-in), network, sandbox, appId?}`
- `POST /api/pi/auth {accessToken, link?}` → exchanges the token with Pi App Studio (above). **No `X-Requested-With` needed**
  for a plain sign-in (the token authenticates the call); `link:true` still requires the header (it acts on the current session).
  - `link:true` and signed in → links the uid to the current account → `{user, piUsername, linked:true}`.
    409 if that Pi account is linked to another account, or the current account is linked to a different Pi account.
  - otherwise, if the uid is linked → signs that account in (sets the session cookie) → `{user, piUsername, linked:true}`.
  - otherwise → `{needsLink:true, username, linked:false}` (no session). 401 `pi_invalid` for a bad token. Rate-limited like login.
- `GET /api/pi/link` (signed in; works with payments off) → `{linked, piUsername|null, network}` — used by Settings.
- `DELETE /api/pi/link` → `{ok, linked:false}`; 409 when the account has no password (would lock the user out).
- `GET /api/pi/wallet?cursor=&limit=&status=` → `{piUsername|null, network, balanceNote, tx:[…], nextCursor}`; newest first,
  `limit` 1–50 (default 20), opaque keyset cursor (400 if malformed). `tx[i]` = `{id, paymentId, amount, memo, status, direction, createdAt, txid, purpose, refId}`.
- `POST /api/pi/payments {amount, memo, purpose, refId?}` → `{id, amount, memo, metadata:{intentId}}`. Requires a linked Pi account
  (409 `pi_not_linked`). Amount > 0, ≤ `PI_MAX_AMOUNT`, rounded to 7 decimals; memo ≤ 200; purpose from `PI_PURPOSES`.
- `POST /api/pi/payments/approve {paymentId}` → reads the payment from Pi, checks owner/direction/network, binds it to
  `metadata.intentId` (or records a `legacy` row when there is no intent), checks the amount, approves on Pi → `{ok, id, status}`.
- `POST /api/pi/payments/complete {paymentId, txid}` → requires Pi to report that exact txid as verified
  (409 `pi_unverified` / `pi_txid_mismatch`), completes on Pi → `{ok, id, status, receipt}`.
- `POST /api/pi/payments/cancel {paymentId}` (or `{intentId}` for an intent never handed to Pi) → `{ok, id, status:"cancelled"}`;
  409 once a verified transaction exists or the payment is completed.
- `POST /api/pi/payments/incomplete {payment}` (from `onIncompletePaymentFound`; only `payment.identifier` is used) →
  verified txid → completed; no transaction → cancelled on Pi and locally; txid present but not yet verified by Pi → `status:"pending"`
  (left `approved`; the reconciliation completes it later — never cancel a payment that may have moved funds). Requires sign-in.
- `GET /api/pi/receipts/:id` (intent id or Pi payment id; owner or admin) →
  `{id, amount, memo, status, txid, network, createdAt, completedAt, piUsername, purpose, explorerUrl}`.
- Admin: `GET /api/admin/pi/reconciliation?date=YYYY-MM-DD` → latest finished run for that date
  `{date, checked, matched, mismatched:[{id, paymentId, local, remote, issue, fixed}], fixed, expired, ran, runs, …}`
  (`ran:false` and zeros when none). `POST /api/admin/pi/reconcile {date?}` runs now (default today, UTC).
- Admin (extra): `POST /api/admin/pi/payments/:id/refund {note?, txid?}` → marks a completed payment `refunded` and adds an
  incoming (`direction:"in"`, purpose `refund`) row with the refund txid; audited.

The legacy routes `POST /api/pi/payments/approve|complete` registered in `platform.js` now delegate to this service
(same paths; responses still contain `ok:true`). The legacy `POST /api/auth/pi` in `users.js` (auto-creates an account) now uses the
same App Studio exchange (`ctx.services.pi.verify`), is gated by `PI_AUTH_ENABLED`, rate-limited like login and CSRF-exempt like
`/api/pi/auth`. (Integrity / minors Pi KYC routes still read `GET /v2/me` for KYC data — unchanged.)

## Client (36b)
- `index.html` loads `<script src="https://sdk.minepi.com/pi-sdk.js"></script>` in `<head>` (Pi's prescribed tag).
- `PiAdapter.init()` → `await Pi.init({version:"2.0"})` (no `sandbox`), when `enabled || authEnabled`.
- `PiAdapter.authenticate()` → `Pi.authenticate(["username","payments"], onIncompletePaymentFound)`, resolves `{accessToken}` only;
  incomplete payments are queued and flushed after `/api/pi/auth` (unchanged).
- `pi-ui.js`: «الدخول بحساب Pi» and the Settings card show when `authEnabled` (even with payments off); the wallet link, the admin
  reconciliation link and every pay button need `enabled`.

## HTTP headers (36b)
- **CSP** (`server/lib/http.js` `buildCsp`): `script-src 'self' https://sdk.minepi.com` + `'sha256-…'` of each inline `<script>` of the
  served HTML file (computed per file in `serveStatic`) — no `'unsafe-inline'` / `'unsafe-eval'` for scripts. Inline event handlers
  are therefore not allowed: markup uses `data-ui="close-sheet|back|compose|route|reload"` (delegated in `platform.js`).
  `connect-src 'self' https://api.minepi.com https://socialchain.app` (+ `LIVEKIT_URL`), `frame-src 'self' https://sdk.minepi.com`,
  `style-src 'self' 'unsafe-inline'`, `object-src 'none'`, `base-uri 'self'`,
  `frame-ancestors 'self' https://*.pinet.com https://*.minepi.com` (+ `CSP_FRAME_ANCESTORS_EXTRA`). **No `X-Frame-Options`.**
- **Session cookie**: `HttpOnly; SameSite=None; Secure` in production (`NODE_ENV=production`), `HttpOnly; SameSite=Lax` on local http.
- **CSRF**: every non-GET route requires `X-Requested-With: mujtama` except beacons and the Pi login endpoints
  (`POST /api/pi/auth` without `link`, `POST /api/auth/pi`) — route option `{ piLogin: true }`.

## Pi App Studio domain validation
`public/pi-app-validation.txt` (body exactly `piappstudio-0doEEbpm48dvXdC2lzWE_TFrt8RtptOc`, no newline) is copied verbatim by
`tools/build.mjs` to `dist/` and served as a plain static file at `/pi-app-validation.txt` (`text/plain; charset=utf-8`, not
compressed, never the SPA fallback). `.editorconfig` / `.gitattributes` keep it byte-exact; the build fails if it gains whitespace.

## Reconciliation
For a date D (UTC): every outgoing transaction with a Pi payment id created on D, plus every still-`created`/`approved` one created
before D+1, is compared with `GET /v2/payments/:id`:
- Pi cancelled, local open → **fixed**: cancelled.
- Pi has a verified txid, local open → **fixed**: completed on Pi (if needed) and locally.
- Pi approved, local created → **fixed**: approved.
- amount differs, txid differs, completed locally but cancelled/unverified on Pi, verified on Pi but cancelled locally,
  missing on Pi, Pi unreachable → **reported** (not touched; needs a human).
Intents with no Pi payment older than `PI_INTENT_TTL_HOURS` are cancelled (`expired`).
The job: `ctx.scheduler.every("pi.reconcile", PI_RECONCILE_INTERVAL_MS)` (leased: one instance at a time) reconciles **yesterday**
once (`kind='job'`); hourly checks make a missed day self-heal. Runs only when Pi is enabled with a key and `PI_JOBS≠0`.

## Bus events
`PI_LINKED`, `PI_UNLINKED`, `PI_PAYMENT_COMPLETED {user, tx, paymentId, amount, purpose, refId}`, `PI_PAYMENT_CANCELLED`,
`PI_PAYMENT_REFUNDED`, `PI_PAYMENT_FAILED` — subscribe to grant whatever the purpose bought (tips, boosts, tickets…).
Grant on `PI_PAYMENT_COMPLETED` only, and make the grant idempotent per `tx`.

## Going live checklist (operator)
1. Testnet first: register the app on the Pi Developer Portal (testnet), set `PI_ENABLED=1`, `PI_API_KEY`, keep `PI_NETWORK=testnet`.
2. Run payments end-to-end in the Pi Browser (sandbox), check `/api/admin/pi/reconciliation`.
3. Mainnet requires a deliberate change of both `PI_NETWORK=mainnet` and `PI_MAINNET_CONFIRM=1`, plus the mainnet API key.
