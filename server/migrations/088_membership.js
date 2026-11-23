/* 088 — v2.156 Free / Plus membership. Additive only.
 *   membership_meta    one-time seeds (e.g. «studio_extended» added to the Plus plan once; an admin may remove it later)
 *   membership_events  the member's own subscription history (started, renewed, cancelled, resumed, expired, payment failed/cancelled)
 * The plan, subscriptions and payments themselves stay in ai_plans / ai_subscriptions / ai_payments (migration 024).
 * down() drops only these. */
module.exports = {
  id: "088_membership",
  async up(db, exec) {
    await exec("CREATE TABLE IF NOT EXISTS membership_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)");
    await exec("CREATE TABLE IF NOT EXISTS membership_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, plan TEXT, ref TEXT, until_at {TS}, created_at {TS} NOT NULL)");
    await exec("CREATE INDEX IF NOT EXISTS membership_events_user ON membership_events(user_id, created_at)");
  },
  async down(db, exec) {
    await exec("DROP TABLE IF EXISTS membership_events"); await exec("DROP TABLE IF EXISTS membership_meta");
  }
};
