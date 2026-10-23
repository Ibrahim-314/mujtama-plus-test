/* 049 — Hijri calendar and seasons «تقويم هجري ومواسم» (phase 68). Additive only: three new tables.
 * hijri_overrides      admin moon-sighting corrections: Hijri month hy/hm actually started on Gregorian day starts_on
 *                      (YYYY-MM-DD). Umm al-Qura (ICU) is the default; an override moves that month's start (±2 days, every
 *                      month stays 29–30 days). Who set it and why is kept for the audit trail.
 * hijri_reminders      a member's opt-in season reminders (ramadan, eid_fitr, hajj, eid_adha): how many days before, and
 *                      whether to be told on the first day.
 * hijri_reminder_log   idempotency: one reminder per member, season, Hijri year and kind (soon | start). */
module.exports = {
  id: "049_hijri",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS hijri_overrides (hy INTEGER NOT NULL, hm INTEGER NOT NULL, starts_on TEXT NOT NULL, note TEXT, set_by TEXT, set_at {TS} NOT NULL, PRIMARY KEY (hy, hm));
CREATE TABLE IF NOT EXISTS hijri_reminders (user_id TEXT NOT NULL, season TEXT NOT NULL, days_before INTEGER NOT NULL DEFAULT 3, on_start INTEGER NOT NULL DEFAULT 1, created_at {TS} NOT NULL, PRIMARY KEY (user_id, season));
CREATE INDEX IF NOT EXISTS hijri_reminders_season ON hijri_reminders(season);
CREATE TABLE IF NOT EXISTS hijri_reminder_log (user_id TEXT NOT NULL, season TEXT NOT NULL, hijri_year INTEGER NOT NULL, kind TEXT NOT NULL, sent_at {TS} NOT NULL, PRIMARY KEY (user_id, season, hijri_year, kind))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS hijri_reminder_log; DROP TABLE IF EXISTS hijri_reminders; DROP TABLE IF EXISTS hijri_overrides`);
  }
};
