/* 077 — v2.78 weekly Vidtik challenges («تحدي الأسبوع»).
 * Additive only: one new table. Nothing existing is renamed, retyped, dropped or rewritten; no backfill.
 *   clip_challenges  id, title, tag (normalised hashtag, no «#»), body, starts_at, ends_at (ISO, ends exclusive),
 *                    status ('active' | 'cancelled' — cancelling is reversible, nothing is ever deleted),
 *                    winners (JSON text, set once when the challenge is finalised after it ends), finalized_at,
 *                    created_by, created_at, updated_at.
 * Entries are NOT stored: a clip takes part when its caption carries the challenge hashtag and it was published inside
 * the window (post_hashtags + posts), so deleting / hiding a clip removes it from the challenge with no extra bookkeeping.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
module.exports = {
  id: "077_clip_challenges",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS clip_challenges (id TEXT PRIMARY KEY, title TEXT NOT NULL, tag TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')), winners TEXT, finalized_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS clip_challenges_window ON clip_challenges(status, ends_at);
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS clip_challenges_window");
    await exec("DROP TABLE IF EXISTS clip_challenges");
  }
};
