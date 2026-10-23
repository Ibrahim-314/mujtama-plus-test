/* 028 — digital wellbeing (phase 45). Additive only: two new tables + one index (no ALTER, nothing dropped, no data copied).
 * Usage time is measured ON THE DEVICE (localStorage); the server never sees sessions, timestamps or per-day usage.
 * wellbeing_settings  the user's wellbeing choices: break reminder minutes (0 = off), daily limit minutes (0 = off), hide counts,
 *                     focus mode, weekly report on/off, share weekly totals (explicit opt-in), weekly email (only sent when SMTP is set).
 * wellbeing_weekly    OPT-IN aggregated weekly totals only (ISO week, total seconds, sessions, active days) uploaded by the client
 *                     when share_totals = 1; used for the weekly in-app report; deleted when the user withdraws the opt-in. */
module.exports = {
  id: "028_wellbeing",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS wellbeing_settings (user_id TEXT PRIMARY KEY, break_minutes INTEGER NOT NULL DEFAULT 0, daily_limit_minutes INTEGER NOT NULL DEFAULT 0, hide_counts INTEGER NOT NULL DEFAULT 0, focus INTEGER NOT NULL DEFAULT 0, weekly_report INTEGER NOT NULL DEFAULT 1, share_totals INTEGER NOT NULL DEFAULT 0, email_report INTEGER NOT NULL DEFAULT 0, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS wellbeing_weekly (user_id TEXT NOT NULL, week TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, sessions INTEGER NOT NULL DEFAULT 0, days INTEGER NOT NULL DEFAULT 0, reported_at {TS}, updated_at {TS} NOT NULL, PRIMARY KEY (user_id, week));
CREATE INDEX IF NOT EXISTS wellbeing_weekly_report ON wellbeing_weekly(reported_at, week)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS wellbeing_weekly; DROP TABLE IF EXISTS wellbeing_settings`);
  }
};
