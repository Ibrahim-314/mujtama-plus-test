/* 035 — Provider activation (phase 52). Additive only: one new table.
 * provider_settings  admin-entered provider configuration (smtp, translate) so a provider can be switched on from the phone
 *                    without touching Railway variables. Environment variables always win over a stored row. Secret fields
 *                    are sealed (AES-256-GCM, key from PROVIDER_SEAL_KEY or a key kept in notify_keys) and never returned by
 *                    any API — admins only see whether a secret is set. */
module.exports = {
  id: "035_providers",
  async up(db, exec) {
    await exec(`CREATE TABLE IF NOT EXISTS provider_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at {TS} NOT NULL)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS provider_settings`);
  }
};
