/* 094 — v2.166 MJT phase 8.3 «السمعة 2»: graded reputation penalties that expire after 12 months. Additive only: one new table +
 * one index. Nothing existing is renamed, retyped, dropped or rewritten; no backfill. user_reputation, users.reputation,
 * points_balances and points_awards are left exactly as they are — the unified reputation (services/reputation-levels.js) is
 * DERIVED from them at read time, so turning the switch off shows the old numbers again.
 *   reputation_penalties  one admin decision: amount 10..200 subtracted from the unified score while active
 *                         (expires_at > now AND revoked_at IS NULL); reason and the deciding admin are required; revoking
 *                         keeps the row (who / when / why). The switch lives in mjt_settings under key 'reputation'.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "094_reputation_penalties",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS reputation_penalties (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, kind TEXT, reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at {TS} NOT NULL, expires_at {TS} NOT NULL, revoked_by TEXT, revoked_at {TS}, revoke_reason TEXT, CHECK (amount >= 10 AND amount <= 200));
CREATE INDEX IF NOT EXISTS reputation_penalties_user ON reputation_penalties(user_id, expires_at)`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS reputation_penalties_user; DROP TABLE IF EXISTS reputation_penalties");
  }
};
