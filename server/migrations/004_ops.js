/* 004 — operations: client error reports, real-user performance (RUM), feature flags. */
module.exports = {
  id: "004_ops",
  up: (db, exec) => exec(`
CREATE TABLE IF NOT EXISTS client_errors (id {SERIAL}, user_id TEXT, message TEXT NOT NULL, stack TEXT, url TEXT, ua TEXT, release TEXT, request_id TEXT, count INTEGER NOT NULL DEFAULT 1, fingerprint TEXT, first_at {TS} NOT NULL, last_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS client_errors_fp ON client_errors(fingerprint);
CREATE TABLE IF NOT EXISTS rum_metrics (id {SERIAL}, name TEXT NOT NULL, value REAL NOT NULL, route TEXT, conn TEXT, device TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS rum_name_at ON rum_metrics(name, at);
CREATE TABLE IF NOT EXISTS feature_flags (key TEXT PRIMARY KEY, description TEXT, enabled INTEGER NOT NULL DEFAULT 0, rollout INTEGER NOT NULL DEFAULT 0, allow {JSON}, updated_at {TS} NOT NULL)`),
  down: (db, exec) => exec(`DROP TABLE IF EXISTS feature_flags; DROP TABLE IF EXISTS rum_metrics; DROP TABLE IF EXISTS client_errors`)
};
