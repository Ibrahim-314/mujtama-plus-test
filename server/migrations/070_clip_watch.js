/* 070 — v2.70 خلاصة اللقطات: per-viewer watch progress for short/long video clips (services/clips.js).
 * Additive only: one new table + one index. Nothing existing is renamed, retyped, dropped or rewritten; no backfill.
 *   clip_watch            one row per (user_id, post_id) (composite PK): watched_ms (furthest point, ms ≥ 0),
 *                         completed 0/1 (INTEGER like every other flag here; sticky once reached), updated_at.
 *                         The PK serves "what did this viewer complete recently" (user_id prefix scan).
 *   clip_watch_post       index (post_id, completed) — the per-post completion aggregate used by ranking
 *                         (COUNT(*) / SUM(completed) for a page of candidate ids; no table scans).
 * IF NOT EXISTS makes a re-run a no-op; down() restores the v2.69 schema exactly (drops only what this file created). */
module.exports = {
  id: "070_clip_watch",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS clip_watch (user_id TEXT NOT NULL, post_id TEXT NOT NULL, watched_ms INTEGER NOT NULL DEFAULT 0 CHECK (watched_ms >= 0), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)), updated_at {TS} NOT NULL, PRIMARY KEY (user_id, post_id));
CREATE INDEX IF NOT EXISTS clip_watch_post ON clip_watch(post_id, completed);
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS clip_watch_post");
    await exec("DROP TABLE IF EXISTS clip_watch");
  }
};
