/* 074 — v2.75 a clip can point at ONE of its author's own market listings or job postings («ربط المقطع بمنتج/وظيفة»).
 * Additive only: one new table. Nothing existing is renamed, retyped, dropped or rewritten; no backfill.
 *   clip_links   post_id (PK, the clip), kind ('product' | 'job'), target_id (market_listings.id | jobs.id),
 *                author_id (the clip author when linked), created_at, updated_at.
 * The link is resolved on read: a listing that is no longer active or a job that is no longer open simply shows nothing.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "074_clip_links",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS clip_links (post_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('product', 'job')), target_id TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS clip_links_target ON clip_links(kind, target_id);
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS clip_links_target");
    await exec("DROP TABLE IF EXISTS clip_links");
  }
};
