/* 061 — «مجتمع كوين» (MJT) stage 1: an in-app balance on its own double-entry ledger. NOT on any blockchain.
 * Additive only: new tables + indexes; nothing existing is touched (the phase 59 points tables stay as they are).
 *   mjt_accounts            one row per account: user:<id> or sys:mint | sys:burn | sys:treasury. `balance` is a cache of
 *                           SUM(mjt_entries.amount) kept in the same DB transaction; CHECK forbids a negative balance on every
 *                           account except sys:mint (allow_negative = 1: minus the total ever issued). status active | frozen.
 *   mjt_tx                  one row per ledger transaction; `ikey` is UNIQUE (idempotency key of every mutation).
 *   mjt_entries             signed integer amounts in minor units (1 MJT = 10,000,000 units); per transaction they sum to 0.
 *   mjt_audit               append-only log written in the same DB transaction as the money movement.
 *   mjt_settings            admin rules (rewards on/off + daily cap, transfers on/off + limits) and the launch timestamp.
 *   mjt_conversion_batches  one row per points → MJT conversion run (rate, totals, dry-run report, rollback stamps).
 *   mjt_conversions         per user per batch; at most ONE applied conversion per user (partial unique index).
 *   mjt_point_links         which points award was turned into MJT, how and for how much; at most one live link per award
 *                           (partial unique index) → a points award can never be paid twice (conversion OR reward). */
module.exports = {
  id: "061_mjt",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mjt_accounts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT, balance BIGINT NOT NULL DEFAULT 0, allow_negative INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', receive INTEGER NOT NULL DEFAULT 1, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, CHECK (allow_negative = 1 OR balance >= 0));
CREATE UNIQUE INDEX IF NOT EXISTS mjt_accounts_user ON mjt_accounts(user_id);
CREATE TABLE IF NOT EXISTS mjt_tx (id TEXT PRIMARY KEY, ikey TEXT NOT NULL, kind TEXT NOT NULL, amount BIGINT NOT NULL, actor_id TEXT, user_id TEXT, other_id TEXT, ref_type TEXT, ref_id TEXT, batch_id TEXT, reverses TEXT, memo TEXT, req_hash TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS mjt_tx_ikey ON mjt_tx(ikey);
CREATE INDEX IF NOT EXISTS mjt_tx_user ON mjt_tx(user_id, kind, created_at);
CREATE INDEX IF NOT EXISTS mjt_tx_ref ON mjt_tx(ref_type, ref_id);
CREATE TABLE IF NOT EXISTS mjt_entries (id {SERIAL}, tx_id TEXT NOT NULL, account_id TEXT NOT NULL, user_id TEXT, amount BIGINT NOT NULL, balance_after BIGINT NOT NULL, created_at {TS} NOT NULL, CHECK (amount <> 0));
CREATE INDEX IF NOT EXISTS mjt_entries_account ON mjt_entries(account_id, id);
CREATE INDEX IF NOT EXISTS mjt_entries_tx ON mjt_entries(tx_id);
CREATE INDEX IF NOT EXISTS mjt_entries_user ON mjt_entries(user_id, id);
CREATE TABLE IF NOT EXISTS mjt_audit (id {SERIAL}, action TEXT NOT NULL, actor_id TEXT, target TEXT, tx_id TEXT, detail TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS mjt_audit_target ON mjt_audit(target, id);
CREATE TABLE IF NOT EXISTS mjt_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS mjt_conversion_batches (id TEXT PRIMARY KEY, rate BIGINT NOT NULL, cutoff {TS} NOT NULL, status TEXT NOT NULL, users INTEGER NOT NULL DEFAULT 0, pts BIGINT NOT NULL DEFAULT 0, amount BIGINT NOT NULL DEFAULT 0, report TEXT, created_by TEXT, created_at {TS} NOT NULL, rolled_back_by TEXT, rolled_back_at {TS});
CREATE TABLE IF NOT EXISTS mjt_conversions (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, user_id TEXT NOT NULL, pts BIGINT NOT NULL, redeemed_pts BIGINT NOT NULL DEFAULT 0, excluded_pts BIGINT NOT NULL DEFAULT 0, amount BIGINT NOT NULL, tx_id TEXT, status TEXT NOT NULL, reversal_tx_id TEXT, created_at {TS} NOT NULL, rolled_back_at {TS});
CREATE UNIQUE INDEX IF NOT EXISTS mjt_conversions_applied ON mjt_conversions(user_id) WHERE status = 'applied';
CREATE INDEX IF NOT EXISTS mjt_conversions_batch ON mjt_conversions(batch_id);
CREATE TABLE IF NOT EXISTS mjt_point_links (id TEXT PRIMARY KEY, award_id TEXT NOT NULL, user_id TEXT NOT NULL, pts INTEGER NOT NULL, amount BIGINT NOT NULL DEFAULT 0, clawed BIGINT NOT NULL DEFAULT 0, source TEXT NOT NULL, batch_id TEXT, conversion_id TEXT, tx_id TEXT, status TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS mjt_point_links_live ON mjt_point_links(award_id) WHERE status <> 'rolled_back';
CREATE INDEX IF NOT EXISTS mjt_point_links_user ON mjt_point_links(user_id, status);
CREATE INDEX IF NOT EXISTS mjt_point_links_conv ON mjt_point_links(conversion_id)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS mjt_point_links; DROP TABLE IF EXISTS mjt_conversions; DROP TABLE IF EXISTS mjt_conversion_batches; DROP TABLE IF EXISTS mjt_settings; DROP TABLE IF EXISTS mjt_audit; DROP TABLE IF EXISTS mjt_entries; DROP TABLE IF EXISTS mjt_tx; DROP TABLE IF EXISTS mjt_accounts`);
  }
};
