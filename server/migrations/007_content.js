/* 007 — content & creation (Track 3): drafts, templates, paragraph comments, stories, media
 * processing queue, audio rooms, per-post analytics. */
module.exports = {
  id: "007_content",
  async up(db, exec) {
    await exec(`ALTER TABLE comments ADD COLUMN anchor TEXT`);
    await exec(`ALTER TABLE posts ADD COLUMN expires_at {TS}`);
    await exec(`
CREATE INDEX IF NOT EXISTS comments_anchor ON comments(post, anchor);
CREATE INDEX IF NOT EXISTS posts_story ON posts(type, expires_at);
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data {JSON} NOT NULL, device TEXT, updated_at {TS} NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS drafts_user ON drafts(user_id, updated_at);
CREATE TABLE IF NOT EXISTS post_templates (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, data {JSON} NOT NULL, uses INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS story_views (story TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at {TS} NOT NULL, PRIMARY KEY (story, user_id));
CREATE TABLE IF NOT EXISTS media_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload {JSON} NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, run_after {TS} NOT NULL, locked_by TEXT, locked_at {TS}, finished_at {TS}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS media_jobs_due ON media_jobs(status, run_after);
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, host TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, topic TEXT, status TEXT NOT NULL DEFAULT 'live', recording_post TEXT, started_at {TS} NOT NULL, ended_at {TS});
CREATE INDEX IF NOT EXISTS rooms_live ON rooms(status, started_at);
CREATE TABLE IF NOT EXISTS room_members (room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, hand INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 1, joined_at {TS} NOT NULL, left_at {TS}, PRIMARY KEY (room, user_id));
CREATE TABLE IF NOT EXISTS post_views (id {SERIAL}, post TEXT NOT NULL, user_id TEXT, source TEXT NOT NULL, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS post_views_post ON post_views(post, at);`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS post_views; DROP TABLE IF EXISTS room_members; DROP TABLE IF EXISTS rooms; DROP TABLE IF EXISTS media_jobs; DROP TABLE IF EXISTS story_views; DROP TABLE IF EXISTS post_templates; DROP TABLE IF EXISTS drafts; DROP INDEX IF EXISTS posts_story; DROP INDEX IF EXISTS comments_anchor`);
    await exec(`ALTER TABLE posts DROP COLUMN expires_at`);
    await exec(`ALTER TABLE comments DROP COLUMN anchor`);
  }
};
