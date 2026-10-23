/* 034 — Pi transfers between users and payment requests (phase 56). Additive only: three new tables + indexes.
 * Amounts are BIGINT units of 1e-7 Pi (same as 020_tips). Money effects are journals in the shared double-entry ledger.
 * pi_transfers      one user→user transfer: sender pays the app (Pi purpose `transfer`, intent_id → pi_transactions.id),
 *                   the recipient's balance account `user:<id>:transfers` is credited (held first for new accounts).
 *                   status: pending | held | completed | cancelled | rejected | refunded.
 * pi_pay_requests   a request for Pi from another user: open → paid (via a transfer) | declined | cancelled | expired.
 * pi_payouts        app→user payouts of a received balance, recorded by staff with the Pi txid (we never hold a wallet seed). */
module.exports = {
  id: "034_transfers",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS pi_transfers (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, amount BIGINT NOT NULL, fee BIGINT NOT NULL DEFAULT 0, note TEXT, request_id TEXT, intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', hold_reason TEXT, reviewed_by TEXT, review_note TEXT, created_at {TS} NOT NULL, paid_at {TS}, completed_at {TS}, cancelled_at {TS}, refunded_at {TS}, reviewed_at {TS});
CREATE INDEX IF NOT EXISTS pi_transfers_sender ON pi_transfers(sender_id, created_at);
CREATE INDEX IF NOT EXISTS pi_transfers_recipient ON pi_transfers(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS pi_transfers_status ON pi_transfers(status, created_at);
CREATE TABLE IF NOT EXISTS pi_pay_requests (id TEXT PRIMARY KEY, requester_id TEXT NOT NULL, payer_id TEXT NOT NULL, amount BIGINT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', transfer_id TEXT, created_at {TS} NOT NULL, responded_at {TS}, expires_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS pi_pay_requests_payer ON pi_pay_requests(payer_id, status, created_at);
CREATE INDEX IF NOT EXISTS pi_pay_requests_requester ON pi_pay_requests(requester_id, created_at);
CREATE TABLE IF NOT EXISTS pi_payouts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount BIGINT NOT NULL, txid TEXT, note TEXT, by_user TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS pi_payouts_user ON pi_payouts(user_id, created_at);`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS pi_payouts; DROP TABLE IF EXISTS pi_pay_requests; DROP TABLE IF EXISTS pi_transfers`);
  }
};
