/* 015 — integrity (Track 7, phase 32): anti-fake-account signals.
 * integrity_meta     server-side key/value (the HMAC salt when INTEGRITY_SALT is not set)
 * device_signals     privacy-preserving device hashes per account (HMAC of client-side SHA-256; never raw values)
 * phone_otps         pending one-time codes (code stored hashed, attempts + expiry)
 * phone_verifications verified phone per account, stored as HMAC + last two digits for display only
 * pi_kyc             Pi Network KYC / linked status as a trust signal
 * integrity_flags    review queue: coordinated networks, multi-accounts, dense clusters, fake followers
 * integrity_limits   reversible soft restrictions applied by staff or by the multi-account policy
 * follower_flags     fake-follower soft hide (follows rows are never deleted; restore flips status) */
module.exports = {
  id: "015_integrity",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS integrity_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS device_signals (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, hash TEXT NOT NULL, first_seen {TS} NOT NULL, last_seen {TS} NOT NULL, hits INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (user_id, kind, hash));
CREATE INDEX IF NOT EXISTS device_signals_hash ON device_signals(kind, hash);
CREATE TABLE IF NOT EXISTS phone_otps (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, phone_hash TEXT NOT NULL, phone_hint TEXT, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, expires_at {TS} NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS phone_otps_user ON phone_otps(user_id, created_at);
CREATE TABLE IF NOT EXISTS phone_verifications (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, phone_hash TEXT NOT NULL, phone_hint TEXT, verified_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS phone_verifications_hash ON phone_verifications(phone_hash);
CREATE TABLE IF NOT EXISTS pi_kyc (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'pi', checked_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS integrity_flags (id TEXT PRIMARY KEY, kind TEXT NOT NULL, sig TEXT NOT NULL, members {JSON}, score REAL NOT NULL DEFAULT 0, reason TEXT, evidence {JSON}, status TEXT NOT NULL DEFAULT 'open', decided_by TEXT, decided_at {TS}, note TEXT, created_at {TS} NOT NULL, updated_at {TS});
CREATE INDEX IF NOT EXISTS integrity_flags_status ON integrity_flags(status, score);
CREATE INDEX IF NOT EXISTS integrity_flags_sig ON integrity_flags(kind, sig);
CREATE TABLE IF NOT EXISTS integrity_limits (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, level TEXT NOT NULL, reason TEXT, flag_id TEXT, by_user TEXT, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS follower_flags (src TEXT NOT NULL, dst TEXT NOT NULL, score REAL NOT NULL DEFAULT 0, reason TEXT, status TEXT NOT NULL DEFAULT 'hidden', flagged_at {TS} NOT NULL, restored_at {TS}, restored_by TEXT, PRIMARY KEY (src, dst));
CREATE INDEX IF NOT EXISTS follower_flags_dst ON follower_flags(dst, status);
CREATE INDEX IF NOT EXISTS follower_flags_src ON follower_flags(src, status)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS follower_flags; DROP TABLE IF EXISTS integrity_limits; DROP TABLE IF EXISTS integrity_flags; DROP TABLE IF EXISTS pi_kyc;
DROP TABLE IF EXISTS phone_verifications; DROP TABLE IF EXISTS phone_otps; DROP TABLE IF EXISTS device_signals; DROP TABLE IF EXISTS integrity_meta`);
  }
};
