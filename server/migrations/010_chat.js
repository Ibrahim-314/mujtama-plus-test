/* 010 — communication (Track 6, phases 26–27): group conversations (title, owner, roles, read
 * cursors), richer messages (kind, reply/quote, attachment meta, E2EE envelope, disappearing timer,
 * delete-for-everyone), reactions, member-only chat blobs, E2EE device keys + safety-number
 * verifications. (Calls live in 012_calls, owned separately.) */
module.exports = {
  id: "010_chat",
  async up(db, exec) {
    await exec(`
ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'dm';
ALTER TABLE conversations ADD COLUMN title TEXT;
ALTER TABLE conversations ADD COLUMN owner TEXT;
ALTER TABLE conversations ADD COLUMN e2ee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN ttl INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE conversation_members ADD COLUMN last_read_at {TS};
ALTER TABLE conversation_members ADD COLUMN joined_at {TS};
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN reply_to TEXT;
ALTER TABLE messages ADD COLUMN meta {JSON};
ALTER TABLE messages ADD COLUMN payload {JSON};
ALTER TABLE messages ADD COLUMN expires_at {TS};
ALTER TABLE messages ADD COLUMN deleted_at {TS};
CREATE INDEX IF NOT EXISTS messages_expires ON messages(expires_at);
CREATE TABLE IF NOT EXISTS message_reactions (msg TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (msg, user_id));
CREATE TABLE IF NOT EXISTS chat_blobs (id TEXT PRIMARY KEY, conv TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, owner TEXT NOT NULL, msg TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL, enc INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS chat_blobs_conv ON chat_blobs(conv);
CREATE INDEX IF NOT EXISTS chat_blobs_msg ON chat_blobs(msg);
CREATE TABLE IF NOT EXISTS device_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, data {JSON} NOT NULL, created_at {TS} NOT NULL, last_seen {TS}, revoked_at {TS});
CREATE INDEX IF NOT EXISTS device_keys_user ON device_keys(user_id);
CREATE TABLE IF NOT EXISTS key_verifications (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, peer TEXT NOT NULL, fingerprint TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (user_id, peer))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS key_verifications; DROP TABLE IF EXISTS device_keys; DROP TABLE IF EXISTS chat_blobs; DROP TABLE IF EXISTS message_reactions; DROP INDEX IF EXISTS messages_expires;
ALTER TABLE messages DROP COLUMN deleted_at; ALTER TABLE messages DROP COLUMN expires_at; ALTER TABLE messages DROP COLUMN payload; ALTER TABLE messages DROP COLUMN meta; ALTER TABLE messages DROP COLUMN reply_to; ALTER TABLE messages DROP COLUMN kind;
ALTER TABLE conversation_members DROP COLUMN joined_at; ALTER TABLE conversation_members DROP COLUMN last_read_at; ALTER TABLE conversation_members DROP COLUMN role;
ALTER TABLE conversations DROP COLUMN ttl; ALTER TABLE conversations DROP COLUMN e2ee; ALTER TABLE conversations DROP COLUMN owner; ALTER TABLE conversations DROP COLUMN title; ALTER TABLE conversations DROP COLUMN kind`);
  }
};
