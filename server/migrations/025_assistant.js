/* 025 — AI assistant (phase 42). Additive only: two new tables + indexes (no ALTER, nothing dropped, no data copied).
 * assistant_vectors  semantic index of PUBLIC content only (public posts outside private communities + their comments; no paid,
 *                    no messages). No user ids. Vector stored as base64 Float32 in `vec` (portable: SQLite + PostgreSQL, searched
 *                    by JS cosine). When the pgvector extension is ALREADY installed on PostgreSQL the service adds an `embedding
 *                    vector` column at runtime and searches with `<=>`; the extension is never required.
 * assistant_meta     small key/value flags for the assistant (e.g. the one-time "assistant added to «مجتمع+ ذكاء»" seed). */
module.exports = {
  id: "025_assistant",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS assistant_vectors (doc_id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL, post_id TEXT NOT NULL, model TEXT NOT NULL, dims INTEGER NOT NULL, vec TEXT NOT NULL, text_hash TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS assistant_vectors_model ON assistant_vectors(model, dims, updated_at);
CREATE INDEX IF NOT EXISTS assistant_vectors_post ON assistant_vectors(post_id);
CREATE TABLE IF NOT EXISTS assistant_meta (key TEXT PRIMARY KEY, value TEXT, updated_at {TS} NOT NULL)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS assistant_meta; DROP TABLE IF EXISTS assistant_vectors`);
  }
};
