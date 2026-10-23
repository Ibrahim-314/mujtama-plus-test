/* 013 — database-backed object storage (STORAGE_DRIVER=db): uploaded media and chat attachments stored
 * inside the main database so they survive redeploys on hosts with an ephemeral filesystem.
 * Purely additive: CREATE TABLE / INDEX IF NOT EXISTS only; no existing table or row is touched. */
module.exports = {
  id: "013_blobs",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL, sha256 TEXT, data {BLOB} NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS blobs_created ON blobs(created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP INDEX IF EXISTS blobs_created; DROP TABLE IF EXISTS blobs`);
  }
};
