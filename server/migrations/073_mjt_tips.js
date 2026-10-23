/* 073 — v2.74 MJT tips on clips and video posts («إكرامية مجتمع كوين»).
 * Additive only: one new table + two indexes. Nothing existing is renamed, retyped, dropped or rewritten; no backfill.
 *   mjt_tips            one row per tip = metadata of ONE mjt_tx (kind 'tip', ref_type 'post', ref_id = post id).
 *                       The money lives only in the MJT ledger (mjt_tx / mjt_entries); this row is written in the same
 *                       DB transaction and only answers "who tipped this clip, how much, shown or anonymous".
 *                       tx_id (PK, = mjt_tx.id), post_id, from_id, to_id (the post author at tip time), amount (minor
 *                       units, > 0), anon (0|1: hidden from the public supporters list; the creator sees «داعم مجهول»
 *                       too), created_at.
 *   mjt_tips_post       index (post_id, created_at) — per-clip total + top supporters.
 *   mjt_tips_to         index (to_id, created_at) — the creator's tips summary in the wallet / studio.
 * Data map: personal data = from_id / to_id (user ids); amounts are already in the ledger. Rows are never updated.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "073_mjt_tips",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mjt_tips (tx_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, amount BIGINT NOT NULL CHECK (amount > 0), anon INTEGER NOT NULL DEFAULT 0 CHECK (anon IN (0, 1)), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS mjt_tips_post ON mjt_tips(post_id, created_at);
CREATE INDEX IF NOT EXISTS mjt_tips_to ON mjt_tips(to_id, created_at);
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS mjt_tips_to");
    await exec("DROP INDEX IF EXISTS mjt_tips_post");
    await exec("DROP TABLE IF EXISTS mjt_tips");
  }
};
