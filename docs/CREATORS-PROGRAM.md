# الصنّاع الموثّقون وصندوق الدعم — Verified creators + support fund (phase 65, v2.39.0)

Service: `server/services/vcreators.js` · migration `052_vcreators` · ledger `FUND` journals in `server/lib/ledger.js` · UI chunk `vcreators-ui.js` + `vcreators.css` · tests `server/test/vcreators.test.js`, `tests/e2e/p65.e2e.test.js`.

## Program
1. `GET /api/creator-program` — benefits, code of conduct, and for a signed-in member the eligibility checklist: adult, account age ≥ `VC_MIN_AGE_DAYS` (30), followers ≥ `VC_MIN_FOLLOWERS` (50), published posts in 90 days ≥ `VC_MIN_POSTS` (10), 2FA on, avatar + bio ≥ 20 letters, no standing moderation decision in 90 days and an active account.
2. `POST /api/creator-program/apply {category, statement, links[], conduct:true}` — only when every check passes; checks are snapshotted for the reviewer. One pending at a time; after a rejection, `VC_REAPPLY_DAYS` (30).
3. Staff `#/admin/creator-program`: approve → `vc_creators` (one year), `users.verified='creator'` **only if it was empty** (`badge_set`), reject with reason, revoke (removes only the badge the program set, withdraws open grant applications), restore — all audited.
4. Job `vcreators.tick` (every `VC_TICK_INTERVAL_MS`, 6 h): reminder 30 days before the end, lapse at the end; `POST /api/creator-program/renew` in the last 60 days when the checks still pass.
5. Directory `GET /api/creator-program/directory?category=&q=`; badge `GET /api/creator-program/badge/:handle`.

## Fund
- Rounds (staff): draft → open (verified creators of the round's categories notified) → review → closed (open applications rejected with a reason). Budget, max grant, window, categories, criteria.
- Applications (verified creators, once per round, inside the window and categories): title, plan (≥ 80 letters), amount ≤ max grant, 1–6 milestones; edit/withdraw while open. Staff: shortlist / approve (award ≤ request, round awards ≤ budget) / reject with reason; private score + note never public.
- Public: `GET /api/fund` (pool, received, donated, donors, awarded, paid, rounds, approved grants, recent donations — anonymous by choice), `GET /api/fund/rounds/:id`, `GET /api/fund/grants/:id` (plan, milestones, payout state + txid, progress updates). Grantee updates `POST …/updates`; reports `POST …/report` → staff queue.

## Money (off in production)
Pi purpose `fund`. Accounts: `platform:creator_fund_funding` → `platform:creator_fund` (staff funding), `user:<id>:pi_out` → fund (donation), fund → `creator:<id>:grants` (reservation at approval when Pi is on, or at payout), grants → `platform:payouts` (staff payout recorded with the Pi txid; no A2U). Donation refunds reverse the journal. While `PI_ENABLED` is off: `POST /api/fund/donate`, `POST /api/admin/fund/pool`, `POST /api/admin/fund/applications/:id/payout` answer **501 `not_configured`**; approvals are recorded with `pay_status = awaiting_pi` and every screen shows the notice.

## Minors
Read-only: cannot apply, be verified, apply for grants or donate.
