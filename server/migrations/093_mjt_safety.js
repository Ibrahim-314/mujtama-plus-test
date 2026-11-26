/* 093 — v2.165 MJT phase 8.1 «محرك آمن»: identity / abuse checks, overall earning caps, new earn sources and an admin review
 * queue for the internal MJT rewards balance. Additive only: one new table + two indexes. Nothing existing is renamed, retyped,
 * dropped or rewritten; no backfill; no balance.
 *   mjt_transfer_holds  a member → member transfer that the identity checks (services/mjt-safety.js, switch OFF by default)
 *                       held for admin review instead of sending it. Nothing moves while it waits: approve → the transfer is
 *                       posted to the ledger then (same idempotency key as the member's request), reject → nothing ever moves.
 *                       status pending | approved | rejected | failed; reasons = JSON array of check codes.
 * The 8.1 settings (switches, caps, identity thresholds) live in the existing mjt_settings table under key 'safety'; held
 * EARNINGS reuse the phase-4 journal (090 mjt_reward_entries, status 'pending'). IF NOT EXISTS makes a re-run a no-op;
 * down() drops only what this file created. */
module.exports = {
  id: "093_mjt_safety",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mjt_transfer_holds (id TEXT PRIMARY KEY, ikey TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, amount BIGINT NOT NULL, note TEXT, reasons TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', tx_id TEXT, decided_by TEXT, decision_reason TEXT, created_at {TS} NOT NULL, decided_at {TS}, CHECK (amount > 0), CHECK (status IN ('pending','approved','rejected','failed')));
CREATE UNIQUE INDEX IF NOT EXISTS mjt_transfer_holds_ikey ON mjt_transfer_holds(ikey);
CREATE INDEX IF NOT EXISTS mjt_transfer_holds_status ON mjt_transfer_holds(status, created_at)`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS mjt_transfer_holds_status; DROP INDEX IF EXISTS mjt_transfer_holds_ikey; DROP TABLE IF EXISTS mjt_transfer_holds");
  }
};
