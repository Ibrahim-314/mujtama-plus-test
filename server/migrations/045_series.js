/* 045 — Scheduled publishing queue + content series (phase 62). Additive only: five new tables + indexes.
 * post_schedules          one row per post that was scheduled (composer or #/scheduled): the author's time zone, the target
 *                         series, publish attempts and the last error. Posts keep using posts.status='scheduled' +
 *                         posts.publish_at (phase 12) — this table is the queue's bookkeeping, not a second source of truth.
 * content_series          a creator's series / collection «سلسلة» of their own posts (articles, posts, audio, video), with a
 *                         description, an optional cover, visibility public | unlisted, and counters.
 * content_series_items    ordered episodes (position); a post belongs to at most one series (unique post_id).
 * content_series_follows  members following a series (notify on / off).
 * content_series_notified idempotency ledger: one «new episode» notification per series, post and follower. */
module.exports = {
  id: "045_series",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS post_schedules (post_id TEXT PRIMARY KEY, author TEXT NOT NULL, tz TEXT, series_id TEXT, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, queued_at {TS} NOT NULL, published_at {TS}, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS post_schedules_author ON post_schedules(author, state);
CREATE TABLE IF NOT EXISTS content_series (id TEXT PRIMARY KEY, author TEXT NOT NULL, title TEXT NOT NULL, descr TEXT, cover TEXT, kind TEXT NOT NULL DEFAULT 'series', visibility TEXT NOT NULL DEFAULT 'public', status TEXT NOT NULL DEFAULT 'active', followers INTEGER NOT NULL DEFAULT 0, last_episode_at {TS}, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS content_series_author ON content_series(author, status, updated_at);
CREATE TABLE IF NOT EXISTS content_series_items (series_id TEXT NOT NULL, post_id TEXT NOT NULL, position INTEGER NOT NULL, added_at {TS} NOT NULL, PRIMARY KEY (series_id, post_id));
CREATE UNIQUE INDEX IF NOT EXISTS content_series_items_post ON content_series_items(post_id);
CREATE INDEX IF NOT EXISTS content_series_items_pos ON content_series_items(series_id, position);
CREATE TABLE IF NOT EXISTS content_series_follows (series_id TEXT NOT NULL, user_id TEXT NOT NULL, notify INTEGER NOT NULL DEFAULT 1, at {TS} NOT NULL, PRIMARY KEY (series_id, user_id));
CREATE INDEX IF NOT EXISTS content_series_follows_user ON content_series_follows(user_id, at);
CREATE TABLE IF NOT EXISTS content_series_notified (series_id TEXT NOT NULL, post_id TEXT NOT NULL, user_id TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (series_id, post_id, user_id))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS content_series_notified; DROP TABLE IF EXISTS content_series_follows; DROP TABLE IF EXISTS content_series_items; DROP TABLE IF EXISTS content_series; DROP TABLE IF EXISTS post_schedules`);
  }
};
