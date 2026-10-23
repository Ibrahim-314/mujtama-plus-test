/* 001 — base schema (v2.0): users, content, communities, messaging, safety, analytics, Pi. */
const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, name TEXT NOT NULL, bio TEXT DEFAULT '', color TEXT, badge TEXT,
  role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active', password_hash TEXT, pi_uid TEXT UNIQUE,
  lang TEXT DEFAULT 'ar', tz TEXT DEFAULT 'Asia/Riyadh', pinned TEXT, prefs {JSON}, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, ip TEXT, ua TEXT, created_at {TS} NOT NULL, expires_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, descr TEXT DEFAULT '', topic TEXT, type TEXT NOT NULL DEFAULT 'public', color TEXT,
  owner TEXT NOT NULL REFERENCES users(id), rules {JSON}, settings {JSON}, location TEXT, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, joined_at {TS} NOT NULL, PRIMARY KEY (community, user_id));
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, author TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL DEFAULT 'post', title TEXT, text TEXT NOT NULL DEFAULT '',
  topic TEXT, lang TEXT, visibility TEXT NOT NULL DEFAULT 'public', status TEXT NOT NULL DEFAULT 'published', community TEXT REFERENCES communities(id),
  quote_of TEXT, repost_of TEXT, series TEXT, part INTEGER, parts INTEGER, location TEXT, publish_at {TS},
  sensitive INTEGER NOT NULL DEFAULT 0, sponsored INTEGER NOT NULL DEFAULT 0, moderation TEXT, views INTEGER NOT NULL DEFAULT 0,
  edited INTEGER NOT NULL DEFAULT 0, data {JSON}, created_at {TS} NOT NULL, updated_at {TS});
CREATE INDEX IF NOT EXISTS posts_status_created ON posts(status, created_at);
CREATE INDEX IF NOT EXISTS posts_author ON posts(author, created_at);
CREATE INDEX IF NOT EXISTS posts_community ON posts(community, status);
CREATE INDEX IF NOT EXISTS posts_series ON posts(series);
CREATE TABLE IF NOT EXISTS post_versions (id {SERIAL}, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, text TEXT, at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS post_hashtags (post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, tag TEXT NOT NULL, created_at {TS} NOT NULL, PRIMARY KEY (post_id, tag));
CREATE INDEX IF NOT EXISTS hashtags_tag ON post_hashtags(tag, created_at);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, author TEXT NOT NULL REFERENCES users(id), parent TEXT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post);
CREATE TABLE IF NOT EXISTS reactions (target TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (target, user_id));
CREATE TABLE IF NOT EXISTS follows (src TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, dst TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at {TS} NOT NULL, PRIMARY KEY (src, dst));
CREATE INDEX IF NOT EXISTS follows_dst ON follows(dst);
CREATE TABLE IF NOT EXISTS poll_votes (post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL, option_idx INTEGER NOT NULL, at {TS} NOT NULL, PRIMARY KEY (post_id, user_id, option_idx));
CREATE TABLE IF NOT EXISTS stance_votes (post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL, idx INTEGER NOT NULL, at {TS} NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, name TEXT NOT NULL, descr TEXT DEFAULT '', starts_at {TS} NOT NULL, place TEXT, organizer TEXT NOT NULL REFERENCES users(id), community TEXT, color TEXT, status TEXT NOT NULL DEFAULT 'upcoming', created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS event_rsvps (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL, kind TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (event_id, user_id, kind));
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, mime TEXT, size INTEGER, storage_key TEXT NOT NULL, status TEXT NOT NULL, variants {JSON}, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS conversation_members (conv TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY (conv, user_id));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conv TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, sender TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, created_at {TS} NOT NULL, read_at {TS});
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv, created_at);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, actor TEXT, post TEXT, ref TEXT, read INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, target TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT, by_user TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolved_by TEXT, resolved_at {TS}, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, target TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT, by_user TEXT, restored INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS appeals (id TEXT PRIMARY KEY, decision_id TEXT NOT NULL REFERENCES decisions(id), text TEXT NOT NULL, by_user TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolved_at {TS}, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id {SERIAL}, action TEXT NOT NULL, target TEXT, reason TEXT, by_user TEXT, at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS analytics_events (id {SERIAL}, user_id TEXT, name TEXT NOT NULL, props {JSON}, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS analytics_name_at ON analytics_events(name, at);
CREATE TABLE IF NOT EXISTS pi_payments (payment_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount REAL, memo TEXT, metadata {JSON}, status TEXT NOT NULL, txid TEXT, created_at {TS} NOT NULL, updated_at {TS});
`;
module.exports = {
  id: "001_base",
  up: (db, exec) => exec(SQL),
  down: (db, exec) => exec(`DROP TABLE IF EXISTS pi_payments;
DROP TABLE IF EXISTS analytics_events;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS appeals;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversation_members;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS event_rsvps;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS stance_votes;
DROP TABLE IF EXISTS poll_votes;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS reactions;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS post_hashtags;
DROP TABLE IF EXISTS post_versions;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS communities;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users`)
};
