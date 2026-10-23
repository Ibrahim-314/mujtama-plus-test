/* 014 — automatic moderation (Track 7, phase 31): quarantined/held content with its classifier verdict
 * (held → released | escalated | removed, never deleted by automation), admin-managed malicious-domain and
 * image-hash block lists, and anonymous "are you sure?" nudge outcomes (no text is stored).
 * Purely additive: CREATE TABLE / INDEX IF NOT EXISTS only; no existing table or row is touched. */
module.exports = {
  id: "014_automod",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS automod_items (id TEXT PRIMARY KEY, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, author TEXT, community TEXT, state TEXT NOT NULL, prev_status TEXT, score REAL NOT NULL DEFAULT 0, categories {JSON}, reasons {JSON}, signals {JSON}, source TEXT NOT NULL DEFAULT 'scan', release_at {TS}, decided_by TEXT, decided_at {TS}, note TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS automod_items_target ON automod_items(target_kind, target_id);
CREATE INDEX IF NOT EXISTS automod_items_state ON automod_items(state, created_at);
CREATE INDEX IF NOT EXISTS automod_items_author ON automod_items(author, created_at);
CREATE INDEX IF NOT EXISTS automod_items_release ON automod_items(state, release_at);
CREATE TABLE IF NOT EXISTS automod_domains (domain TEXT PRIMARY KEY, verdict TEXT NOT NULL DEFAULT 'bad', reason TEXT, added_by TEXT, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS automod_hashes (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, added_by TEXT, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS automod_nudges (id TEXT PRIMARY KEY, user_id TEXT, level TEXT NOT NULL, outcome TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS automod_nudges_at ON automod_nudges(created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS automod_nudges; DROP TABLE IF EXISTS automod_hashes; DROP TABLE IF EXISTS automod_domains; DROP INDEX IF EXISTS automod_items_release; DROP INDEX IF EXISTS automod_items_author; DROP INDEX IF EXISTS automod_items_state; DROP INDEX IF EXISTS automod_items_target; DROP TABLE IF EXISTS automod_items`);
  }
};
