/* 057 — Jobs & freelance board «الوظائف والعمل الحر» (phase 77). Additive only: six new tables. Pi amounts are BIGINT units
 * of 1e-7 π on PostgreSQL (the phase 65 INTEGER overflow lesson).
 * jobs              a posting: job (employment) or freelance project; title, description, category, skills, place mode, pay range in
 *                   π (fixed / hourly / monthly / unpaid), deadline, up to 3 screening questions, status review | open | paused |
 *                   closed | filled | removed, anti-scam review reasons, featured-until (paid boost), views, application count.
 * job_applications  one per member and posting: cover letter, answers, freelance bid (π + days), pipeline status and the
 *                   employer's private note.
 * job_events        the application timeline both sides see: status changes and messages (risky messages carry a warning).
 * job_saved         bookmarked postings.
 * job_reports       reports on a posting (scam, fee to apply, fake, inappropriate, discrimination, other).
 * job_boosts        featured-listing purchases paid with Pi (only while Pi payments are enabled). */
module.exports = {
  id: "057_jobs",
  async up(db, exec, dialect) {
    const BIG = dialect === "postgres" ? "BIGINT" : "INTEGER";
    await exec(`
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, poster_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL, skills TEXT, mode TEXT NOT NULL DEFAULT 'remote', city TEXT, country TEXT, employment TEXT, pay_type TEXT NOT NULL DEFAULT 'fixed', pay_min ${BIG}, pay_max ${BIG}, deadline TEXT, questions TEXT, minors_ok INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'review', review_reasons TEXT, removed_reason TEXT, featured_until {TS}, views INTEGER NOT NULL DEFAULT 0, apps INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, published_at {TS}, closed_at {TS});
CREATE INDEX IF NOT EXISTS jobs_list ON jobs(status, published_at);
CREATE INDEX IF NOT EXISTS jobs_poster ON jobs(poster_id, status);
CREATE TABLE IF NOT EXISTS job_applications (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, applicant_id TEXT NOT NULL, cover TEXT NOT NULL, answers TEXT, bid ${BIG}, days INTEGER, status TEXT NOT NULL DEFAULT 'submitted', note TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, UNIQUE (job_id, applicant_id));
CREATE INDEX IF NOT EXISTS job_apps_job ON job_applications(job_id, status);
CREATE INDEX IF NOT EXISTS job_apps_user ON job_applications(applicant_id, updated_at);
CREATE TABLE IF NOT EXISTS job_events (id TEXT PRIMARY KEY, app_id TEXT NOT NULL, actor_id TEXT, kind TEXT NOT NULL, status TEXT, body TEXT, warn INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS job_events_app ON job_events(app_id, created_at);
CREATE TABLE IF NOT EXISTS job_saved (user_id TEXT NOT NULL, job_id TEXT NOT NULL, created_at {TS} NOT NULL, PRIMARY KEY (user_id, job_id));
CREATE TABLE IF NOT EXISTS job_reports (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, by_user TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', created_at {TS} NOT NULL, decided_at {TS}, decided_by TEXT, UNIQUE (job_id, by_user));
CREATE INDEX IF NOT EXISTS job_reports_status ON job_reports(status, created_at);
CREATE TABLE IF NOT EXISTS job_boosts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, user_id TEXT NOT NULL, days INTEGER NOT NULL, amount ${BIG} NOT NULL, intent_id TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at {TS} NOT NULL, completed_at {TS});
CREATE INDEX IF NOT EXISTS job_boosts_intent ON job_boosts(intent_id)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS job_boosts; DROP TABLE IF EXISTS job_reports; DROP TABLE IF EXISTS job_saved; DROP TABLE IF EXISTS job_events; DROP TABLE IF EXISTS job_applications; DROP TABLE IF EXISTS jobs`);
  }
};
