/* 089 — v2.159 unified achievement events (MJT readiness). Additive only: one new table + indexes; nothing existing is touched.
 *   achievement_events  append-only record that a member reached a milestone (quiz passed, course completed, team created,
 *                       collection created, saved search created, article published). One row per (user_id, type, ref) —
 *                       the UNIQUE index makes record() idempotent. It holds NO amount, NO balance and credits nothing:
 *                       it is only the signal a later, separately approved rewards stage may read.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "089_achievements",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS achievement_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, ref TEXT NOT NULL, meta TEXT, created_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS achievement_events_once ON achievement_events(user_id, type, ref);
CREATE INDEX IF NOT EXISTS achievement_events_type ON achievement_events(type, created_at)`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS achievement_events_type; DROP INDEX IF EXISTS achievement_events_once; DROP TABLE IF EXISTS achievement_events");
  }
};
