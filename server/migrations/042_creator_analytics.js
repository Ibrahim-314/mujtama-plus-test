/* 042 — Advanced creator analytics (phase 61). Additive only: two new tables + indexes; nothing existing changes.
 * content_attention  one row per (post, signed-in viewer, UTC day): attention time on the post page / video / audio (ms,
 *                    capped per beacon and per day) and the furthest progress reached (0–100 %, read or watched).
 *                    Feeds watch time / read time and completion. Anonymous viewers are never recorded; the creator only
 *                    ever sees aggregates (k-anonymous where they could single somebody out).
 * audience_events    follow / unfollow events per creator from now on (the follows table forgets unfollows), so audience
 *                    growth is net (new − lost) and follower retention per cohort can be measured.
 * creator_goals      a creator's own goals (followers / monthly views / posts per week / engagement rate) with a target;
 *                    progress is computed live from the reports, never stored. */
module.exports = {
  id: "042_creator_analytics",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS content_attention (id {SERIAL}, post TEXT NOT NULL, author TEXT NOT NULL, user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, ms BIGINT NOT NULL DEFAULT 0, progress INTEGER NOT NULL DEFAULT 0, media_ms BIGINT NOT NULL DEFAULT 0, at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS content_attention_uniq ON content_attention(post, user_id, day);
CREATE INDEX IF NOT EXISTS content_attention_author ON content_attention(author, at);
CREATE TABLE IF NOT EXISTS audience_events (id {SERIAL}, creator_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS audience_events_creator ON audience_events(creator_id, at);
CREATE TABLE IF NOT EXISTS creator_goals (user_id TEXT NOT NULL, metric TEXT NOT NULL, target REAL NOT NULL, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, PRIMARY KEY (user_id, metric))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS creator_goals; DROP TABLE IF EXISTS audience_events; DROP TABLE IF EXISTS content_attention`);
  }
};
