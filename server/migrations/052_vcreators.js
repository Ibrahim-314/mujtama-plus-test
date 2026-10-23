/* 052 — Verified creators program + creator support fund «برنامج الصنّاع الموثّقين وصندوق دعم» (phase 65). Additive only:
 * seven new tables, nothing existing is touched (users.verified is only ever SET to 'creator' when empty, by the service).
 * vc_applications  a member's application to the program: category, statement, links (JSON), the eligibility checks as they
 *                  were when applying (JSON snapshot), code-of-conduct acceptance, pending | approved | rejected | withdrawn.
 * vc_creators      the current program membership: verified | revoked | lapsed, since / until (yearly renewal), whether the
 *                  program set the users.verified badge (so revoking removes only what the program added), reminder flag.
 * fund_rounds      a support-fund round run by staff: title, description, criteria, categories (JSON), declared budget and
 *                  max grant (1e-7 Pi units), application window, draft | open | review | closed.
 * fund_applications a verified creator's project application to a round (one per round): plan, requested amount, milestones,
 *                  staff decision (score, private note, public reason, award) and payout state
 *                  (none | awaiting_pi | reserved | paid) with the Pi txid of the staff payout.
 * fund_updates     public progress updates a funded creator posts on their grant page.
 * fund_donations   members' donations to the fund (Pi intent, pending | completed | cancelled, anonymous flag).
 * fund_reports     reports on a grant (misuse, misleading, other) for the staff queue. */
module.exports = {
  id: "052_vcreators",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS vc_applications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category TEXT NOT NULL, statement TEXT NOT NULL, links TEXT, checks TEXT, conduct_at {TS} NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reason TEXT, reviewer TEXT, created_at {TS} NOT NULL, decided_at {TS});
CREATE INDEX IF NOT EXISTS vc_applications_user ON vc_applications(user_id, created_at);
CREATE INDEX IF NOT EXISTS vc_applications_status ON vc_applications(status, created_at);
CREATE TABLE IF NOT EXISTS vc_creators (user_id TEXT PRIMARY KEY, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'verified', since {TS} NOT NULL, until {TS} NOT NULL, badge_set INTEGER NOT NULL DEFAULT 0, reason TEXT, reminded INTEGER NOT NULL DEFAULT 0, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS vc_creators_status ON vc_creators(status, category);
CREATE TABLE IF NOT EXISTS fund_rounds (id TEXT PRIMARY KEY, title TEXT NOT NULL, descr TEXT NOT NULL, criteria TEXT, categories TEXT, budget INTEGER NOT NULL DEFAULT 0, max_grant INTEGER NOT NULL DEFAULT 0, opens_at {TS} NOT NULL, closes_at {TS} NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS fund_rounds_status ON fund_rounds(status, opens_at);
CREATE TABLE IF NOT EXISTS fund_applications (id TEXT PRIMARY KEY, round_id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL, plan TEXT NOT NULL, amount INTEGER NOT NULL, milestones TEXT, status TEXT NOT NULL DEFAULT 'submitted', score INTEGER, note TEXT, reason TEXT, award INTEGER NOT NULL DEFAULT 0, pay_status TEXT NOT NULL DEFAULT 'none', payout_tx TEXT, decided_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, decided_at {TS}, paid_at {TS}, UNIQUE (round_id, user_id));
CREATE INDEX IF NOT EXISTS fund_applications_round ON fund_applications(round_id, status);
CREATE INDEX IF NOT EXISTS fund_applications_user ON fund_applications(user_id);
CREATE TABLE IF NOT EXISTS fund_updates (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS fund_updates_app ON fund_updates(application_id, created_at);
CREATE TABLE IF NOT EXISTS fund_donations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, anonymous INTEGER NOT NULL DEFAULT 0, intent_id TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at {TS} NOT NULL, completed_at {TS});
CREATE INDEX IF NOT EXISTS fund_donations_intent ON fund_donations(intent_id);
CREATE INDEX IF NOT EXISTS fund_donations_user ON fund_donations(user_id);
CREATE TABLE IF NOT EXISTS fund_reports (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, by_user TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', created_at {TS} NOT NULL, decided_at {TS}, UNIQUE (application_id, by_user))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS fund_reports; DROP TABLE IF EXISTS fund_donations; DROP TABLE IF EXISTS fund_updates; DROP TABLE IF EXISTS fund_applications; DROP TABLE IF EXISTS fund_rounds; DROP TABLE IF EXISTS vc_creators; DROP TABLE IF EXISTS vc_applications`);
  }
};
