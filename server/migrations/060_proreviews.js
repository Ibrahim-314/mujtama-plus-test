/* 060 — Professional reputation & verified reviews «السمعة المهنية والتقييمات الموثّقة» (phase 80). Additive only: four new
 * tables (prefix pr_ — the phase 7 `reputation` service keeps its own data).
 * pr_reviews       one review per engagement, author and reviewee: engagement kind contract | team + its id, the author's
 *                  role (client | worker | teammate), overall 1–5 and three criteria 1–5, text, revealed_at (double-blind:
 *                  hidden from the reviewee until both sides reviewed or the window closed), status published | flagged |
 *                  hidden, the reviewee's public response.
 * pr_endorsements  skill endorsements between verified collaborators (a completed contract or team in common), one per
 *                  endorser, member and skill.
 * pr_reports       reports on a review (one per member and review), decided by staff.
 * pr_prompts       «you can review now» notifications already sent (one per engagement and member). */
module.exports = {
  id: "060_proreviews",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS pr_reviews (id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL, author_id TEXT NOT NULL, target_id TEXT NOT NULL, role TEXT NOT NULL, overall INTEGER NOT NULL, c1 INTEGER, c2 INTEGER, c3 INTEGER, body TEXT, warn INTEGER NOT NULL DEFAULT 0, flags TEXT, status TEXT NOT NULL DEFAULT 'published', revealed_at {TS}, closes_at {TS} NOT NULL, response TEXT, response_at {TS}, staff_note TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, UNIQUE (kind, ref_id, author_id, target_id));
CREATE INDEX IF NOT EXISTS pr_reviews_target ON pr_reviews(target_id, status, created_at);
CREATE INDEX IF NOT EXISTS pr_reviews_author ON pr_reviews(author_id, created_at);
CREATE INDEX IF NOT EXISTS pr_reviews_status ON pr_reviews(status);
CREATE TABLE IF NOT EXISTS pr_endorsements (user_id TEXT NOT NULL, by_user TEXT NOT NULL, norm TEXT NOT NULL, name TEXT NOT NULL, basis TEXT, created_at {TS} NOT NULL, PRIMARY KEY (user_id, by_user, norm));
CREATE INDEX IF NOT EXISTS pr_endorsements_by ON pr_endorsements(by_user);
CREATE TABLE IF NOT EXISTS pr_reports (id TEXT PRIMARY KEY, review_id TEXT NOT NULL, by_user TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', created_at {TS} NOT NULL, decided_at {TS}, decided_by TEXT, UNIQUE (review_id, by_user));
CREATE INDEX IF NOT EXISTS pr_reports_status ON pr_reports(status, review_id);
CREATE TABLE IF NOT EXISTS pr_prompts (kind TEXT NOT NULL, ref_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at {TS} NOT NULL, PRIMARY KEY (kind, ref_id, user_id))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS pr_prompts; DROP TABLE IF EXISTS pr_reports; DROP TABLE IF EXISTS pr_endorsements; DROP TABLE IF EXISTS pr_reviews`);
  }
};
