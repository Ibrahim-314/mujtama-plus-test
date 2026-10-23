/* 079 — v2.87 «التعدين»: daily MJT mining sessions + the daily sign-in reward.
 * Additive only: two new tables and their indexes. Nothing existing is renamed, retyped, dropped or rewritten.
 *   mjt_mining     one row per 24-hour mining session a member starts. amount = what the session mints when claimed
 *                  (rate per day × (100 + boost)/100, fixed when it starts). status: active → claimed. At most one active
 *                  session per member (partial unique index). tx_id = the ledger transaction that paid it.
 *   mjt_checkins   one row per member per UTC day for the sign-in reward (primary key makes it once a day).
 * IF NOT EXISTS makes a re-run a no-op; down() restores the v2.86 schema exactly. */
module.exports = {
  id: "079_mjt_mining",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mjt_mining (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, started_at {TS} NOT NULL, ends_at {TS} NOT NULL, rate BIGINT NOT NULL, boost INTEGER NOT NULL DEFAULT 0, amount BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'active', claimed_at {TS}, tx_id TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS mjt_mining_active ON mjt_mining(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS mjt_mining_user ON mjt_mining(user_id, started_at);
CREATE TABLE IF NOT EXISTS mjt_checkins (user_id TEXT NOT NULL, day TEXT NOT NULL, amount BIGINT NOT NULL, tx_id TEXT, created_at {TS} NOT NULL, PRIMARY KEY (user_id, day));
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS mjt_mining_user; DROP INDEX IF EXISTS mjt_mining_active; DROP TABLE IF EXISTS mjt_mining; DROP TABLE IF EXISTS mjt_checkins");
  }
};
