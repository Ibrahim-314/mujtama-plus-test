/* 003 — security: 2FA (TOTP + backup codes), passkeys, session ids & devices, tamper-evident audit chain. */
module.exports = {
  id: "003_security",
  async up(db, exec, d) {
    await exec(`
CREATE TABLE IF NOT EXISTS user_2fa (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, backup_codes {JSON}, last_step INTEGER, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, name TEXT, created_at {TS} NOT NULL, last_used_at {TS});
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
CREATE TABLE IF NOT EXISTS webauthn_challenges (challenge TEXT PRIMARY KEY, user_id TEXT, kind TEXT NOT NULL, expires_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS known_devices (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, first_seen {TS} NOT NULL, last_seen {TS} NOT NULL, PRIMARY KEY (user_id, fingerprint))`);
    await exec(`ALTER TABLE sessions ADD COLUMN sid TEXT;
ALTER TABLE sessions ADD COLUMN last_seen {TS};
ALTER TABLE sessions ADD COLUMN mfa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_log ADD COLUMN hash TEXT`);
    await exec(`CREATE INDEX IF NOT EXISTS sessions_sid ON sessions(sid)`);
  },
  async down(db, exec, d) {
    await exec(`DROP TABLE IF EXISTS known_devices; DROP TABLE IF EXISTS webauthn_challenges; DROP TABLE IF EXISTS passkeys; DROP TABLE IF EXISTS user_2fa; DROP INDEX IF EXISTS sessions_sid`);
    await exec(`ALTER TABLE sessions DROP COLUMN sid; ALTER TABLE sessions DROP COLUMN last_seen; ALTER TABLE sessions DROP COLUMN mfa; ALTER TABLE audit_log DROP COLUMN prev_hash; ALTER TABLE audit_log DROP COLUMN hash`);
  }
};
