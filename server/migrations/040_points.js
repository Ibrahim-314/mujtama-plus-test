/* 040 — Contribution rewards + points linked to Pi (phase 59). Additive only: new tables + indexes.
 * points_awards       append-style award log: one row per (user, kind, source) — accepted answer, engaged post, confirmed report,
 *                     wiki edit, mentoring, campaign bonus, admin adjustment, redemption (negative) — with redeemable=0 for
 *                     minors, status active | reversed (content removed / redemption rejected), campaign and day.
 * points_balances     per user: total, redeemable, redeemed, level, leaderboard opt-out (derived cache of points_awards).
 * points_settings     admin-set rules: per-kind points + caps, trust threshold, redemption rate, monthly pool cap, on/off.
 * points_campaigns    seasonal campaigns: kinds, multiplier, bonus, window; their own leaderboard.
 * points_redemptions  points → Pi requests paid from the platform-funded rewards pool (lib/ledger.js accounts); staff pay
 *                     from the app wallet and record the txid (no A2U, the server holds no wallet seed). */
module.exports = {
  id: "040_points",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS points_awards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, points INTEGER NOT NULL, redeemable INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active', campaign_id TEXT, day TEXT NOT NULL, reason TEXT, created_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS points_awards_src ON points_awards(user_id, kind, source_id);
CREATE INDEX IF NOT EXISTS points_awards_user ON points_awards(user_id, created_at);
CREATE INDEX IF NOT EXISTS points_awards_day ON points_awards(day, user_id);
CREATE INDEX IF NOT EXISTS points_awards_source ON points_awards(source_id);
CREATE TABLE IF NOT EXISTS points_balances (user_id TEXT PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0, redeemable INTEGER NOT NULL DEFAULT 0, redeemed INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0, optout INTEGER NOT NULL DEFAULT 0, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS points_balances_total ON points_balances(total);
CREATE TABLE IF NOT EXISTS points_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS points_campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, kinds TEXT NOT NULL DEFAULT '[]', multiplier REAL NOT NULL DEFAULT 1, bonus INTEGER NOT NULL DEFAULT 0, starts_at {TS} NOT NULL, ends_at {TS} NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_by TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS points_campaigns_window ON points_campaigns(status, starts_at, ends_at);
CREATE TABLE IF NOT EXISTS points_redemptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, points INTEGER NOT NULL, amount BIGINT NOT NULL, rate INTEGER NOT NULL, month TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', txid TEXT, note TEXT, decided_by TEXT, decided_at {TS}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS points_redemptions_user ON points_redemptions(user_id, created_at);
CREATE INDEX IF NOT EXISTS points_redemptions_month ON points_redemptions(month, status)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS points_redemptions; DROP TABLE IF EXISTS points_campaigns; DROP TABLE IF EXISTS points_settings; DROP TABLE IF EXISTS points_balances; DROP TABLE IF EXISTS points_awards`);
  }
};
