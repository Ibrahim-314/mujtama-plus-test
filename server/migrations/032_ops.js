/* 032 — monitoring & operations (phase 49). Additive only: new tables + indexes (no ALTER, nothing dropped, no data copied).
 * ops_rollups            per-minute request rollups per instance (requests, 5xx, slow, latency sum/p95, queue backlog)
 *                        → admin charts, SLO error budgets and alert rules survive restarts and add up across replicas.
 * ops_component_checks   hourly up/down tallies per component → 90-day uptime on the public /status page.
 * ops_alert_rules        on-call rules (metric, op, threshold, window, channels); ops_alerts = firing/resolved history.
 * ops_slos               service-level objectives (availability / latency) with their window.
 * ops_incidents          incidents posted by admins on /status; ops_incident_updates = their timeline.
 * ops_dr_drills          results of disaster-recovery drills (reported by server/scripts/dr-drill.js; no data, only counts). */
module.exports = {
  id: "032_ops",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS ops_rollups (bucket TEXT NOT NULL, instance TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, slow INTEGER NOT NULL DEFAULT 0, dur_ms_sum REAL NOT NULL DEFAULT 0, p95_ms REAL NOT NULL DEFAULT 0, queue_backlog INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bucket, instance));
CREATE INDEX IF NOT EXISTS ops_rollups_bucket ON ops_rollups(bucket);
CREATE TABLE IF NOT EXISTS ops_component_checks (component TEXT NOT NULL, bucket TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (component, bucket));
CREATE TABLE IF NOT EXISTS ops_alert_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, metric TEXT NOT NULL, op TEXT NOT NULL DEFAULT '>', threshold REAL NOT NULL, window_min INTEGER NOT NULL DEFAULT 5, severity TEXT NOT NULL DEFAULT 'warning', channels TEXT NOT NULL DEFAULT 'inapp,webhook,email', enabled INTEGER NOT NULL DEFAULT 1, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS ops_alerts (id {SERIAL}, rule_id TEXT NOT NULL, state TEXT NOT NULL, value REAL, started_at {TS} NOT NULL, resolved_at {TS}, sent TEXT);
CREATE INDEX IF NOT EXISTS ops_alerts_rule ON ops_alerts(rule_id, state);
CREATE TABLE IF NOT EXISTS ops_slos (id TEXT PRIMARY KEY, name TEXT NOT NULL, sli TEXT NOT NULL, target REAL NOT NULL, window_days INTEGER NOT NULL DEFAULT 30, enabled INTEGER NOT NULL DEFAULT 1, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS ops_incidents (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, impact TEXT NOT NULL DEFAULT 'minor', components TEXT NOT NULL DEFAULT '', created_by TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, resolved_at {TS});
CREATE INDEX IF NOT EXISTS ops_incidents_created ON ops_incidents(created_at);
CREATE TABLE IF NOT EXISTS ops_incident_updates (id {SERIAL}, incident_id TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, by_user TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS ops_incident_updates_inc ON ops_incident_updates(incident_id, at);
CREATE TABLE IF NOT EXISTS ops_dr_drills (id {SERIAL}, at {TS} NOT NULL, ok INTEGER NOT NULL, backup TEXT, dialect TEXT, tables_n INTEGER, rows_n INTEGER, ms INTEGER, detail TEXT)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS ops_dr_drills; DROP TABLE IF EXISTS ops_incident_updates; DROP TABLE IF EXISTS ops_incidents; DROP TABLE IF EXISTS ops_slos; DROP TABLE IF EXISTS ops_alerts; DROP TABLE IF EXISTS ops_alert_rules; DROP TABLE IF EXISTS ops_component_checks; DROP TABLE IF EXISTS ops_rollups`);
  }
};
