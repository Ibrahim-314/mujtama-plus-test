/* 072 — v2.70 resumable video upload: a durable registry of chunked upload sessions.
 * Additive only: one new table + two indexes. Nothing existing is renamed, retyped, dropped or rewritten; no backfill.
 *   upload_sessions        one resumable upload (POST /api/media/uploads): owner, sanitized filename, mime, kind,
 *                          declared size, chunk_size, total_chunks, received (JSON array of chunk indexes), status
 *                          open | done, media_id (set by complete; a retried complete returns the same media),
 *                          created_at / updated_at / expires_at (24 h after the last chunk by default).
 *                          The chunk BYTES never live here: they are temp files under <storageDir>/tmp/uploads/<id>/
 *                          and are deleted on complete or when the session expires (swept on boot + every 30 min).
 *   upload_sessions_owner  index (owner, status) — "how many open uploads does this user have" (per-user cap).
 *   upload_sessions_exp    index (expires_at) — the expiry sweep.
 * Data map: personal data = owner (user id) + the original filename; deleted with the session after 24 h, never exported.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only what this file created. */
const STATUS = Object.freeze(["open", "done"]);
const FILENAME_MAX = 200;
const list = a => a.map(s => `'${s}'`).join(", ");

module.exports = {
  id: "072_upload_sessions",
  STATUS, FILENAME_MAX,
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS upload_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND ${FILENAME_MAX}), mime TEXT NOT NULL, kind TEXT NOT NULL, size BIGINT NOT NULL CHECK (size > 0), chunk_size INTEGER NOT NULL CHECK (chunk_size > 0), total_chunks INTEGER NOT NULL CHECK (total_chunks > 0), received TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (${list(STATUS)})), media_id TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, expires_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS upload_sessions_owner ON upload_sessions(owner, status);
CREATE INDEX IF NOT EXISTS upload_sessions_exp ON upload_sessions(expires_at);
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS upload_sessions_exp");
    await exec("DROP INDEX IF EXISTS upload_sessions_owner");
    await exec("DROP TABLE IF EXISTS upload_sessions");
  }
};
