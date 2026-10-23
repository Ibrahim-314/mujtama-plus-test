# MJT stage 2 — a test asset on the Pi **Testnet** (plan only)

> **Status: plan. Nothing in this document exists yet.** No wallet, key, Railway variable, trustline or asset has been created.
> Stage 1 (v2.47.0) is the in-app ledger described in [MJT.md](MJT.md); it is not on any chain.
> This stage uses the **Pi Testnet only**. Test-Pi and a Testnet asset have **no monetary value**, and nothing here makes MJT a
> Pi Mainnet token. Pi Mainnet token issuance is restricted by Pi Network; the only announced path is the **Pi Launchpad**
> (in Testnet since March 2026, no Mainnet date as of October 2026). Mainnet is out of scope until Pi opens it and the user decides.

Source of the Testnet facts: Pi developer docs, "Tokens" (developers.minepi.com/docs/use-native-features/Tokens), read on
2026-10-17. The Pi blockchain is a Stellar-protocol network, so standard Stellar asset mechanics apply. Re-check the doc before
building — it may have changed.

## 1. Network

| | |
|---|---|
| Horizon | `https://api.testnet.minepi.com` |
| Network passphrase | `"Pi Testnet"` |
| SDK | `@stellar/stellar-sdk` (server side only; added as a dependency in the stage 2 release) |
| Asset code | `MJT` (≤ 12 chars, alphanumeric — fits a 4-char `credit_alphanum4` asset) |
| Precision | 7 decimals — identical to stage 1 units (1 MJT = 10,000,000), so ledger units map 1:1 |

## 2. Accounts (to be created in stage 2, by the user's decision)

1. **Issuer** — creates MJT. Holds nothing. Its secret signs only issuance; after the planned supply is issued it can be
   **locked** (master weight 0, thresholds set) so the supply becomes fixed — the Stellar best practice for a fixed-supply asset.
   Whether to lock (fixed supply) or keep issuing to match stage 1 rewards is an open decision (see §7).
2. **Distributor** — holds the circulating MJT, sends to members. Establishes a **trustline** to `MJT:<issuer>`.
3. Both funded with **Test-Pi** from the Pi Testnet faucet / Pi Developer Portal tools (no real Pi).

Issuance on Stellar = the distributor trusts the asset, then the issuer **pays** MJT to the distributor (a payment from the
issuer mints). Members who want the Testnet asset in their Pi Wallet add a trustline from their own wallet.

## 3. Keys and secrets

- Secrets live **only** in Railway service variables on the existing `web` service (e.g. `MJT_TESTNET_ISSUER_SECRET`,
  `MJT_TESTNET_DISTRIBUTOR_SECRET`, `MJT_TESTNET_ENABLED=1`), read through `lib/secrets.js` (`*_FILE` supported). Never in the
  repository, the database, logs, the client bundle, or a test fixture.
- The server never signs for a member; members sign in their own Pi Wallet.
- Prefer keeping the issuer secret **offline** after setup (only the distributor key on the server). If the issuer is locked,
  its secret is no longer needed at all.
- Rotation: a new distributor account + trustline, move the balance, update the variable. Document every key change in the
  audit log (no key material).
- Creating these accounts/variables needs the user's explicit approval (standing production rules: no new keys without it).

## 4. `pi.toml` (asset listing)

Set the issuer's `home_domain` to the app domain (`mjt.up.railway.app` or a custom domain) and serve
`https://<domain>/.well-known/pi.toml` (static, `text/plain`, CORS `*`), e.g.:

```toml
[[CURRENCIES]]
code = "MJT"
issuer = "G…ISSUER_PUBLIC_KEY…"
name = "Mujtama Coin — مجتمع كوين (Testnet)"
desc = "Test asset on the Pi Testnet for the Mujtama+ community app. No monetary value. Linked to the in-app MJT balance."
image = "https://<domain>/assets/mjt-512.png"
```

Served by a new tiny SSR handler (like `/pi-app-validation.txt`), with the public key from a non-secret variable
(`MJT_TESTNET_ISSUER_PUBLIC`). The image is a new 512×512 PNG in `/assets` (needs the user's approval of the design).

## 5. Linking the Testnet asset to the stage 1 ledger

Principle: the **in-app ledger stays the source of truth**; the chain is a mirror the member opts into.

- New system account in the ledger: `sys:bridge` (MJT that currently sits on the Testnet).
- **Withdraw to Testnet** (member → own Pi Testnet wallet, opt-in, adults only, limits as transfers): ledger transaction
  `user → sys:bridge` with an idempotency key, then the server builds + signs a distributor payment to the member's address
  (which must already trust MJT), submits to Horizon, stores the tx hash. If Horizon fails definitively → reversal
  (`sys:bridge → user`). Pending submissions are retried with the same sequence/tx to stay idempotent.
- **Deposit from Testnet** (member pays MJT to the distributor with a memo = a one-time deposit code): a watcher streams the
  distributor's payments from Horizon (`/accounts/<distributor>/payments`, cursor stored), matches the memo, posts
  `sys:bridge → user` once per Horizon operation id (the operation id is the idempotency key).
- **Reconciliation** (scheduled): distributor's on-chain MJT balance + (issued − held by others) must equal `sys:bridge`'s
  ledger balance; any difference raises an ops alert and pauses withdrawals.
- Everything is labelled «شبكة Pi التجريبية — بلا قيمة مالية» in the UI.

## 6. Build steps (stage 2 release, after approval)

1. Add `@stellar/stellar-sdk`; `server/lib/pi-testnet.js` (Horizon client with the passphrase, timeouts, retries; no secrets in logs).
2. Admin checklist in `#/admin/mjt`: network reachable, issuer/distributor exist, trustline present, `home_domain` set,
   `pi.toml` served and matching, issuer locked (or not, by decision).
3. Migration `0xx_mjt_bridge` (additive): `mjt_bridge_ops` (direction, member address, amount, ledger tx, horizon hash /
   operation id UNIQUE, status), `mjt_bridge_cursor`.
4. Withdraw / deposit flows + watcher + reconciliation; feature flag `MJT_TESTNET_ENABLED`; 501 while unset.
5. Tests: Horizon stubbed (no network in CI), property tests extended with bridge operations, replayed Horizon events,
   partial failures; one manual end-to-end run on the real Pi Testnet with test accounts.
6. Docs + CHANGELOG; deploy; the user creates the two Testnet accounts and sets the Railway variables (or approves us doing it).

## 7. Open decisions for the user

- Fixed Testnet supply (lock the issuer) vs. issuing as members withdraw.
- Who may withdraw (all adults? verified accounts only?) and limits.
- The asset image and the public name/description wording.
- Custom domain for `home_domain` (a Railway subdomain works but is less permanent).
- Whether/when to apply to the Pi Launchpad for a Mainnet path (Pi's rules apply; Launchpad proceeds go to a liquidity pool).
