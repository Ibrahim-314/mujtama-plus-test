/* 090 — v2.160 MJT internal rewards economy (phase 4). Additive only: two new tables + indexes. Nothing existing is renamed,
 * retyped, dropped or rewritten; no backfill. Balances stay in the existing double-entry ledger (061: mjt_accounts =
 * the wallet, mjt_tx / mjt_entries = posted movements, mjt_audit = append-only audit) — this migration adds no balance.
 *   mjt_reward_sources  one row per reward source (an achievement type from 089). amount (minor units) is NULL and enabled
 *                       is 0 by default: nothing is ever paid until an admin sets an amount AND enables the source.
 *                       daily_cap / weekly_cap / monthly_cap = how many rewards of this source one member may receive per
 *                       period (NULL = no cap); max_per_ref = per member per referenced object; requires_approval = 1 → every
 *                       reward of this source waits as «pending» for an admin.
 *   mjt_reward_entries  append-only journal of every reward-engine movement: kind earn | spend | adjust_credit | adjust_debit,
 *                       amount (minor units, > 0), status posted | pending | rejected, idempotency_key UNIQUE, source, ref,
 *                       reason, actor_id, tx_id (the ledger transaction when posted), balance_after (when posted).
 *                       Rows are never updated or deleted: approving or rejecting a pending entry APPENDS a decision row
 *                       whose `decides` names it (unique → at most one decision per pending entry).
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "090_mjt_rewards",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mjt_reward_sources (key TEXT PRIMARY KEY, label TEXT NOT NULL, amount BIGINT, daily_cap INTEGER, weekly_cap INTEGER, monthly_cap INTEGER, max_per_ref INTEGER DEFAULT 1, requires_approval INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0, updated_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, CHECK (amount IS NULL OR amount > 0));
CREATE TABLE IF NOT EXISTS mjt_reward_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, amount BIGINT NOT NULL, balance_after BIGINT, source TEXT, ref TEXT, reason TEXT, status TEXT NOT NULL, idempotency_key TEXT NOT NULL, actor_id TEXT, tx_id TEXT, decides TEXT, created_at {TS} NOT NULL, CHECK (amount > 0), CHECK (kind IN ('earn','spend','adjust_credit','adjust_debit')), CHECK (status IN ('posted','pending','rejected')));
CREATE UNIQUE INDEX IF NOT EXISTS mjt_reward_entries_ikey ON mjt_reward_entries(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS mjt_reward_entries_decides ON mjt_reward_entries(decides) WHERE decides IS NOT NULL;
CREATE INDEX IF NOT EXISTS mjt_reward_entries_user ON mjt_reward_entries(user_id, created_at);
CREATE INDEX IF NOT EXISTS mjt_reward_entries_status ON mjt_reward_entries(status, created_at);
CREATE INDEX IF NOT EXISTS mjt_reward_entries_source ON mjt_reward_entries(source, user_id, created_at)`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS mjt_reward_entries_source; DROP INDEX IF EXISTS mjt_reward_entries_status; DROP INDEX IF EXISTS mjt_reward_entries_user; DROP INDEX IF EXISTS mjt_reward_entries_decides; DROP INDEX IF EXISTS mjt_reward_entries_ikey; DROP TABLE IF EXISTS mjt_reward_entries; DROP TABLE IF EXISTS mjt_reward_sources");
  }
};
