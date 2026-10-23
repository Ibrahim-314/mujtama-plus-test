/* 011 — smart notifications & email (Track 6, phases 28–29): web-push subscriptions, per-user notification
 * settings (per-kind channels, quiet hours), importance + group key on notifications, a delivery log for the
 * push/email channels, account email + verification, one-time email tokens (verify / reset), an email log
 * with provider message ids for delivery & bounce tracking, a suppression list, and server key material
 * (VAPID keys and the unsubscribe-token secret when they are not supplied through the environment). */
module.exports = {
  id: "011_notify",
  async up(db, exec) {
    await exec(`
ALTER TABLE notifications ADD COLUMN importance INTEGER;
ALTER TABLE notifications ADD COLUMN group_key TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at {TS};
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email);
CREATE INDEX IF NOT EXISTS notifications_unread ON notifications(user_id, read, created_at);
CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created_at {TS} NOT NULL, last_ok_at {TS}, fail_count INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS notify_settings (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, channels {JSON}, quiet_enabled INTEGER NOT NULL DEFAULT 0, quiet_start TEXT NOT NULL DEFAULT '22:00', quiet_end TEXT NOT NULL DEFAULT '07:00', quiet_tz TEXT, quiet_urgent INTEGER NOT NULL DEFAULT 1, email_notify INTEGER NOT NULL DEFAULT 1, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS notify_deliveries (id TEXT PRIMARY KEY, notification TEXT NOT NULL, user_id TEXT NOT NULL, channel TEXT NOT NULL, target TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS notify_deliveries_n ON notify_deliveries(notification);
CREATE INDEX IF NOT EXISTS notify_deliveries_user ON notify_deliveries(user_id, created_at);
CREATE TABLE IF NOT EXISTS email_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, email TEXT, expires_at {TS} NOT NULL, used_at {TS}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens(user_id, kind);
CREATE TABLE IF NOT EXISTS email_log (id TEXT PRIMARY KEY, user_id TEXT, email TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT, message_id TEXT, status TEXT NOT NULL, detail TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS email_log_mid ON email_log(message_id);
CREATE INDEX IF NOT EXISTS email_log_email ON email_log(email, created_at);
CREATE TABLE IF NOT EXISTS email_suppressions (email TEXT PRIMARY KEY, reason TEXT NOT NULL, detail TEXT, soft_count INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS notify_keys (name TEXT PRIMARY KEY, value TEXT NOT NULL, created_at {TS} NOT NULL)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS notify_keys; DROP TABLE IF EXISTS email_suppressions; DROP TABLE IF EXISTS email_log; DROP TABLE IF EXISTS email_tokens; DROP TABLE IF EXISTS notify_deliveries;
DROP TABLE IF EXISTS notify_settings; DROP TABLE IF EXISTS push_subscriptions; DROP INDEX IF EXISTS notifications_unread; DROP INDEX IF EXISTS users_email`);
    await exec(`ALTER TABLE users DROP COLUMN email_verified_at`);
    await exec(`ALTER TABLE users DROP COLUMN email`);
    await exec(`ALTER TABLE notifications DROP COLUMN group_key`);
    await exec(`ALTER TABLE notifications DROP COLUMN importance`);
  }
};
