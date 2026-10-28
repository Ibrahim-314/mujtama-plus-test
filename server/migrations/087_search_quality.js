/* 087 — v2.133 search stage 10 (safety & quality). Additive only.
 *   search_clicks   aggregated result clicks per normalised query (no user id stored) → a small learned boost
 *   search_metrics  one row per day: searches, zero-result searches, clicks, total latency (ms)
 *   search_zero     zero-result queries (normalised) with a count — what the index or the community is missing
 * down() drops only these. */
module.exports = {
  id: "087_search_quality",
  async up(db, exec) {
    await exec("CREATE TABLE IF NOT EXISTS search_clicks (qn TEXT NOT NULL, ref_id TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL, PRIMARY KEY (qn, ref_id))");
    await exec("CREATE TABLE IF NOT EXISTS search_metrics (day TEXT PRIMARY KEY, searches INTEGER NOT NULL DEFAULT 0, zero INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0)");
    await exec("CREATE TABLE IF NOT EXISTS search_zero (qn TEXT PRIMARY KEY, q TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL)");
  },
  async down(db, exec) {
    await exec("DROP TABLE IF EXISTS search_zero"); await exec("DROP TABLE IF EXISTS search_metrics"); await exec("DROP TABLE IF EXISTS search_clicks");
  }
};
