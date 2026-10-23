/* 005 — search acceleration (Phase 5). PostgreSQL: pg_trgm GIN indexes make LOWER(..) LIKE '%term%'
 * index-assisted for Arabic and Latin text. SQLite (dev/tests) keeps sequential scans. */
module.exports = {
  id: "005_search",
  async up(db, exec, d) {
    if (d !== "postgres") return;
    await exec(`CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS posts_text_trgm ON posts USING gin (LOWER(text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS posts_title_trgm ON posts USING gin (LOWER(COALESCE(title,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_name_trgm ON users USING gin (LOWER(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_handle_trgm ON users USING gin (LOWER(handle) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS hashtags_tag_trgm ON post_hashtags USING gin (tag gin_trgm_ops)`);
  },
  async down(db, exec, d) {
    if (d !== "postgres") return;
    await exec(`DROP INDEX IF EXISTS posts_text_trgm; DROP INDEX IF EXISTS posts_title_trgm; DROP INDEX IF EXISTS users_name_trgm; DROP INDEX IF EXISTS users_handle_trgm; DROP INDEX IF EXISTS hashtags_tag_trgm`);
  }
};
