/* 086 — v2.125 search stage 2: meaning vectors for hybrid (lexical + semantic) retrieval. Additive only.
 *   search_vec      one row per searchable post/community: v = int8 unit vector (base64, lib/search-embed.js), sv = model version
 *   search_vec_lsh  8 LSH band buckets per vector (bk = band*256 + bucket) — candidate lookup that stays fast at millions of rows
 * Vectors are filled by indexing and by the background upgrade in batches. down() drops only these. */
module.exports = {
  id: "086_search_vectors",
  async up(db, exec) {
    await exec("CREATE TABLE IF NOT EXISTS search_vec (kind TEXT NOT NULL, ref_id TEXT NOT NULL, v TEXT NOT NULL, sv INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (kind, ref_id))");
    await exec("CREATE TABLE IF NOT EXISTS search_vec_lsh (bk INTEGER NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, PRIMARY KEY (bk, kind, ref_id))");
    await exec("CREATE INDEX IF NOT EXISTS search_vec_lsh_doc ON search_vec_lsh(kind, ref_id)");
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS search_vec_lsh_doc"); await exec("DROP TABLE IF EXISTS search_vec_lsh"); await exec("DROP TABLE IF EXISTS search_vec");
  }
};
