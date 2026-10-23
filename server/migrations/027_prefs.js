/* 027 — Server-stored user preferences (phase 44: personalization). Additive only: one new table + one index
 * (verify-migrations --static clean; no ALTER, nothing dropped, no data copied).
 * user_prefs  key/value settings per user, grouped in namespaces (`ui` = theme, palette, OLED, density, nav order, app icon;
 *             other namespaces are free-form for later phases). value is JSON as TEXT (parsed and validated by services/prefs.js).
 *             Synced across the user's devices (last write wins per key, server time). Phase 43 keeps a11y.* in its own table. */
module.exports = {
  id: "027_prefs",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS user_prefs (user_id TEXT NOT NULL, ns TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at {TS} NOT NULL, PRIMARY KEY (user_id, ns, key));
CREATE INDEX IF NOT EXISTS user_prefs_updated ON user_prefs(user_id, updated_at)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS user_prefs`);
  }
};
