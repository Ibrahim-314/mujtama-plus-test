/* 075 — v2.76 more ways a Vidtik clip can point somewhere («روابط فيديوتك»).
 * Additive only: three new tables. Nothing existing is renamed, retyped, dropped or rewritten; no backfill.
 *   clip_links_ext   post_id (PK, the clip), kind ('community' | 'event' | 'course'), target_id, author_id, created_at, updated_at.
 *                    Same idea as clip_links (074) for the new kinds; a clip holds ONE link across both tables (the service
 *                    clears the other table when it sets one). Resolved on read: a closed / past / unpublished target shows nothing.
 *   clip_link_clicks post_id, user_id, day ('YYYY-MM-DD'), at — one row per viewer per clip per day, so the author's click
 *                    count can't be inflated by tapping the same chip again and again.
 *   clip_pins        user_id (PK), post_id, at — the one clip a creator pins to the top of their Vidtik profile.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "075_clip_links_plus",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS clip_links_ext (post_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('community', 'event', 'course')), target_id TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS clip_links_ext_target ON clip_links_ext(kind, target_id);
CREATE TABLE IF NOT EXISTS clip_link_clicks (post_id TEXT NOT NULL, user_id TEXT NOT NULL, day TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (post_id, user_id, day));
CREATE TABLE IF NOT EXISTS clip_pins (user_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, at TEXT NOT NULL);
`);
  },
  async down(db, exec) {
    await exec("DROP TABLE IF EXISTS clip_pins");
    await exec("DROP TABLE IF EXISTS clip_link_clicks");
    await exec("DROP INDEX IF EXISTS clip_links_ext_target");
    await exec("DROP TABLE IF EXISTS clip_links_ext");
  }
};
