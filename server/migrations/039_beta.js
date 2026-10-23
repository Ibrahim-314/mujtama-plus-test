/* 039 — Invite-based beta launch (phase 54), built on the phase 50 waitlist / invites / LAUNCH_MODE. Additive only: new tables + indexes.
 * beta_cohorts       waves (e.g. wave 1 = 100, wave 2 = 1000): capacity, per-member invite quota, planned → open → closed.
 * beta_members       one row per beta tester: cohort, how they joined (waitlist | invite | staff), quota + invites used, badge,
 *                    first meaningful action (activation) and last activity.
 * beta_activity      one row per tester per active day (D1 / D7 retention).
 * beta_feedback      in-app feedback (bug | idea | other): text, optional screenshot (media id), route, device info, triage status,
 *                    priority, assignee; beta_feedback_msgs holds the staff ↔ tester conversation (reply → notification).
 * beta_surveys       NPS (0–10) / satisfaction (1–5) answers; beta_survey_state when a prompt was last shown / answered.
 * beta_flag_rules    per feature flag: cohorts that get it early and a kill switch (applied on top of feature_flags). */
module.exports = {
  id: "039_beta",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS beta_cohorts (id TEXT PRIMARY KEY, name TEXT NOT NULL, wave INTEGER NOT NULL, capacity INTEGER NOT NULL, invite_quota INTEGER NOT NULL DEFAULT 3, status TEXT NOT NULL DEFAULT 'planned', opened_at {TS}, opened_by TEXT, closed_at {TS}, created_at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS beta_cohorts_wave ON beta_cohorts(wave);
CREATE TABLE IF NOT EXISTS beta_members (user_id TEXT PRIMARY KEY, cohort_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'staff', invited_by TEXT, invite_code TEXT, quota INTEGER NOT NULL DEFAULT 3, invites_used INTEGER NOT NULL DEFAULT 0, badge INTEGER NOT NULL DEFAULT 1, joined_at {TS} NOT NULL, activated_at {TS}, last_active_at {TS});
CREATE INDEX IF NOT EXISTS beta_members_cohort ON beta_members(cohort_id, joined_at);
CREATE TABLE IF NOT EXISTS beta_activity (user_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS beta_feedback (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, cohort_id TEXT, kind TEXT NOT NULL, text TEXT NOT NULL, media_id TEXT, route TEXT, device TEXT, release TEXT, status TEXT NOT NULL DEFAULT 'new', priority TEXT NOT NULL DEFAULT 'normal', assignee TEXT, last_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS beta_feedback_status ON beta_feedback(status, created_at);
CREATE INDEX IF NOT EXISTS beta_feedback_user ON beta_feedback(user_id, created_at);
CREATE TABLE IF NOT EXISTS beta_feedback_msgs (id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL, author_id TEXT NOT NULL, staff INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS beta_feedback_msgs_fb ON beta_feedback_msgs(feedback_id, created_at);
CREATE TABLE IF NOT EXISTS beta_surveys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, cohort_id TEXT, kind TEXT NOT NULL, score INTEGER NOT NULL, comment TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS beta_surveys_kind ON beta_surveys(kind, created_at);
CREATE TABLE IF NOT EXISTS beta_survey_state (user_id TEXT NOT NULL, kind TEXT NOT NULL, shown_at {TS}, answered_at {TS}, dismissed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, kind));
CREATE TABLE IF NOT EXISTS beta_flag_rules (flag_key TEXT PRIMARY KEY, cohorts TEXT NOT NULL DEFAULT '[]', killed INTEGER NOT NULL DEFAULT 0, kill_reason TEXT, killed_by TEXT, killed_at {TS}, updated_at {TS} NOT NULL)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS beta_flag_rules; DROP TABLE IF EXISTS beta_survey_state; DROP TABLE IF EXISTS beta_surveys; DROP TABLE IF EXISTS beta_feedback_msgs; DROP TABLE IF EXISTS beta_feedback; DROP TABLE IF EXISTS beta_activity; DROP TABLE IF EXISTS beta_members; DROP TABLE IF EXISTS beta_cohorts`);
  }
};
