/* 056 — Professional profile & CV «الملف المهني والسيرة الذاتية» (phase 76). Additive only: four new tables.
 * pro_profiles  one per member: headline, about, city/country text, what they are open to (JSON list), languages (JSON),
 *               links (JSON), whole-profile visibility (public | members | followers | private), per-section visibility
 *               (JSON map), listed in the talent directory (searchable), show verified certificates, staff hide, views.
 * pro_items     experience / education / portfolio / volunteering / award entries with dates (YYYY-MM), order and an
 *               optional link; portfolio entries may point at one of the member's own posts.
 * pro_skills    up to 30 skills per member (normalised key for search and, later, endorsements) with level and years.
 * pro_reports   reports on a professional profile (fake credentials, impersonation, scam, inappropriate) for staff. */
module.exports = {
  id: "056_proprofile",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS pro_profiles (user_id TEXT PRIMARY KEY, headline TEXT NOT NULL, about TEXT, city TEXT, country TEXT, open_to TEXT, languages TEXT, links TEXT, visibility TEXT NOT NULL DEFAULT 'members', sections TEXT, searchable INTEGER NOT NULL DEFAULT 1, show_certs INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0, hidden_reason TEXT, views INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS pro_profiles_list ON pro_profiles(searchable, hidden, updated_at);
CREATE TABLE IF NOT EXISTS pro_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, org TEXT, place TEXT, start_ym TEXT, end_ym TEXT, current INTEGER NOT NULL DEFAULT 0, body TEXT, url TEXT, post_id TEXT, pos INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS pro_items_user ON pro_items(user_id, kind, pos);
CREATE TABLE IF NOT EXISTS pro_skills (user_id TEXT NOT NULL, norm TEXT NOT NULL, name TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 3, years INTEGER, pos INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, PRIMARY KEY (user_id, norm));
CREATE INDEX IF NOT EXISTS pro_skills_norm ON pro_skills(norm);
CREATE TABLE IF NOT EXISTS pro_reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, by_user TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', created_at {TS} NOT NULL, decided_at {TS}, decided_by TEXT, UNIQUE (user_id, by_user));
CREATE INDEX IF NOT EXISTS pro_reports_status ON pro_reports(status, created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS pro_reports; DROP TABLE IF EXISTS pro_skills; DROP TABLE IF EXISTS pro_items; DROP TABLE IF EXISTS pro_profiles`);
  }
};
