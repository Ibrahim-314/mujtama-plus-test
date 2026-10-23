/* 009 — discovery & feed (Track 5): ranking feedback + meaningful-engagement signals + feed tabs and
 * "caught up" state; built-in Arabic-normalised search index, term dictionary, history, saved searches
 * with alerts; trend snapshots per country/city with manipulation flags and summaries; topic/hashtag
 * follows and curated topic pages; people lists; saved-item collections with notes, read-later
 * reminders and share codes; summaries cache, LLM cost ledger and digest settings/log. */
module.exports = {
  id: "009_discovery",
  async up(db, exec, d) {
    await exec(`
CREATE TABLE IF NOT EXISTS feed_feedback (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, target TEXT NOT NULL, weight REAL NOT NULL, created_at {TS} NOT NULL, PRIMARY KEY (user_id, kind, target));
CREATE TABLE IF NOT EXISTS engagement_signals (id {SERIAL}, user_id TEXT NOT NULL, post TEXT NOT NULL, author TEXT, topic TEXT, kind TEXT NOT NULL, weight REAL NOT NULL, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS engagement_user ON engagement_signals(user_id, at);
CREATE INDEX IF NOT EXISTS engagement_post ON engagement_signals(post, kind);
CREATE TABLE IF NOT EXISTS feed_prefs (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, tabs {JSON}, chrono INTEGER NOT NULL DEFAULT 0, seen_at {TS}, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS search_docs (kind TEXT NOT NULL, ref_id TEXT NOT NULL, title TEXT, body TEXT NOT NULL, ptype TEXT, community TEXT, lang TEXT, author TEXT, visibility TEXT NOT NULL DEFAULT 'public', created_at {TS} NOT NULL, PRIMARY KEY (kind, ref_id));
CREATE INDEX IF NOT EXISTS search_docs_kind ON search_docs(kind, created_at);
CREATE TABLE IF NOT EXISTS search_terms (term TEXT PRIMARY KEY, df INTEGER NOT NULL DEFAULT 1, display TEXT);
CREATE TABLE IF NOT EXISTS search_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, q TEXT NOT NULL, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS search_history_user ON search_history(user_id, at);
CREATE TABLE IF NOT EXISTS saved_searches (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, q TEXT NOT NULL, filters {JSON}, alert INTEGER NOT NULL DEFAULT 0, last_checked {TS} NOT NULL, new_count INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS trend_snapshots (scope TEXT NOT NULL, key TEXT NOT NULL, tag TEXT NOT NULL, rank INTEGER NOT NULL, score REAL NOT NULL, posts INTEGER NOT NULL, uniq INTEGER NOT NULL, velocity REAL NOT NULL, flagged INTEGER NOT NULL DEFAULT 0, reason TEXT, brief {JSON}, computed_at {TS} NOT NULL, PRIMARY KEY (scope, key, tag));
CREATE TABLE IF NOT EXISTS topic_follows (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at {TS} NOT NULL, PRIMARY KEY (user_id, kind, ref));
CREATE INDEX IF NOT EXISTS topic_follows_ref ON topic_follows(kind, ref);
CREATE TABLE IF NOT EXISTS topic_pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, descr TEXT DEFAULT '', color TEXT, emoji TEXT, data {JSON}, updated_by TEXT, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS people_lists (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, descr TEXT DEFAULT '', visibility TEXT NOT NULL DEFAULT 'private', created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS people_lists_owner ON people_lists(owner);
CREATE TABLE IF NOT EXISTS people_list_members (list TEXT NOT NULL REFERENCES people_lists(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, added_at {TS} NOT NULL, PRIMARY KEY (list, user_id));
CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT, emoji TEXT, position INTEGER NOT NULL DEFAULT 0, share_code TEXT UNIQUE, updated_at {TS} NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS collections_owner ON collections(owner, position);
CREATE TABLE IF NOT EXISTS collection_items (collection TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, post TEXT NOT NULL, note TEXT, position INTEGER NOT NULL DEFAULT 0, remind_at {TS}, reminded INTEGER NOT NULL DEFAULT 0, added_at {TS} NOT NULL, updated_at {TS} NOT NULL, PRIMARY KEY (collection, post));
CREATE INDEX IF NOT EXISTS collection_items_remind ON collection_items(reminded, remind_at);
CREATE TABLE IF NOT EXISTS collection_tombstones (owner TEXT NOT NULL, collection TEXT NOT NULL, post TEXT NOT NULL DEFAULT '', at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS collection_tombstones_owner ON collection_tombstones(owner, at);
CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, source_hash TEXT NOT NULL, provider TEXT NOT NULL, points {JSON}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS summaries_ref ON summaries(kind, ref);
CREATE TABLE IF NOT EXISTS llm_usage (day TEXT NOT NULL, provider TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, provider));
CREATE TABLE IF NOT EXISTS digest_settings (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, weekly_email INTEGER NOT NULL DEFAULT 0, email TEXT, daily INTEGER NOT NULL DEFAULT 1, last_weekly {TS}, updated_at {TS} NOT NULL)`);
    if (d === "postgres") await exec(`CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX IF NOT EXISTS search_docs_body_trgm ON search_docs USING gin (body gin_trgm_ops); CREATE INDEX IF NOT EXISTS search_terms_trgm ON search_terms USING gin (term gin_trgm_ops)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS digest_settings; DROP TABLE IF EXISTS llm_usage; DROP TABLE IF EXISTS summaries; DROP TABLE IF EXISTS collection_tombstones; DROP TABLE IF EXISTS collection_items; DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS people_list_members; DROP TABLE IF EXISTS people_lists; DROP TABLE IF EXISTS topic_pages; DROP TABLE IF EXISTS topic_follows; DROP TABLE IF EXISTS trend_snapshots;
DROP TABLE IF EXISTS saved_searches; DROP TABLE IF EXISTS search_history; DROP TABLE IF EXISTS search_terms; DROP TABLE IF EXISTS search_docs; DROP TABLE IF EXISTS feed_prefs; DROP TABLE IF EXISTS engagement_signals; DROP TABLE IF EXISTS feed_feedback`);
  }
};
