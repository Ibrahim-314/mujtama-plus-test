/* 017 — transparency & compliance (Track 7, phase 34): periodic transparency reports (aggregates only),
 * reporter-facing report status updates (one row per status change, also the notification ledger),
 * data-subject requests (export / delete with grace period / inquiries) with PDPL deadlines, consent history
 * (append-only), per-type retention overrides and retention run log, and the personal-data breach log.
 * Additive only: new tables and indexes; existing data is never touched. */
module.exports = {
  id: "017_compliance",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS transparency_reports (period TEXT PRIMARY KEY, kind TEXT NOT NULL, starts_at {TS} NOT NULL, ends_at {TS} NOT NULL, data {JSON} NOT NULL, published INTEGER NOT NULL DEFAULT 1, generated_by TEXT, generated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS report_updates (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, at {TS} NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS report_updates_once ON report_updates(report_id, status);
CREATE INDEX IF NOT EXISTS report_updates_user ON report_updates(user_id, at);
CREATE INDEX IF NOT EXISTS reports_by_user ON reports(by_user, created_at);
CREATE INDEX IF NOT EXISTS reports_status_resolved ON reports(status, resolved_at);
CREATE TABLE IF NOT EXISTS dsr_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, response TEXT, meta {JSON}, due_at {TS} NOT NULL, scheduled_for {TS}, completed_at {TS}, cancelled_at {TS}, handled_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS dsr_requests_user ON dsr_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS dsr_requests_status ON dsr_requests(status, kind, scheduled_for);
CREATE TABLE IF NOT EXISTS consents (id {SERIAL}, user_id TEXT NOT NULL, purpose TEXT NOT NULL, granted INTEGER NOT NULL, version TEXT, source TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS consents_user ON consents(user_id, purpose, at);
CREATE TABLE IF NOT EXISTS retention_policies (data_type TEXT PRIMARY KEY, days INTEGER, enabled INTEGER, updated_by TEXT, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS retention_runs (id TEXT PRIMARY KEY, mode TEXT NOT NULL, data {JSON}, by_user TEXT, started_at {TS} NOT NULL, finished_at {TS});
CREATE INDEX IF NOT EXISTS retention_runs_started ON retention_runs(started_at);
CREATE TABLE IF NOT EXISTS breach_log (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, severity TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open', occurred_at {TS}, detected_at {TS} NOT NULL, contained_at {TS}, authority_notified_at {TS}, users_notified_at {TS}, affected_count INTEGER, data {JSON}, created_by TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS breach_log_detected ON breach_log(detected_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS breach_log; DROP TABLE IF EXISTS retention_runs; DROP TABLE IF EXISTS retention_policies; DROP TABLE IF EXISTS consents;
DROP TABLE IF EXISTS dsr_requests; DROP INDEX IF EXISTS reports_status_resolved; DROP INDEX IF EXISTS reports_by_user; DROP TABLE IF EXISTS report_updates; DROP TABLE IF EXISTS transparency_reports`);
  }
};
