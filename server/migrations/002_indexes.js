/* 002 — query-plan driven indexes for feed, notifications, search, moderation and analytics. */
const IDX = [
  ["posts_visibility_created", "posts(visibility, status, created_at)"],
  ["posts_topic_created", "posts(topic, created_at)"],
  ["posts_quote_of", "posts(quote_of)"],
  ["posts_repost_of", "posts(repost_of)"],
  ["posts_publish_due", "posts(status, publish_at)"],
  ["comments_author", "comments(author, created_at)"],
  ["comments_parent", "comments(parent)"],
  ["reactions_user", "reactions(user_id, at)"],
  ["follows_src_at", "follows(src, at)"],
  ["memberships_user", "memberships(user_id)"],
  ["notifications_unread", "notifications(user_id, read, created_at)"],
  ["reports_status", "reports(status, created_at)"],
  ["sessions_user", "sessions(user_id)"],
  ["sessions_expires", "sessions(expires_at)"],
  ["media_owner", "media(owner, created_at)"],
  ["events_starts", "events(status, starts_at)"],
  ["conv_members_user", "conversation_members(user_id)"],
  ["analytics_user_at", "analytics_events(user_id, at)"]
];
module.exports = {
  id: "002_indexes",
  up: (db, exec) => exec(IDX.map(([n, on]) => `CREATE INDEX IF NOT EXISTS ${n} ON ${on}`).join(";\n")),
  down: (db, exec) => exec(IDX.map(([n]) => `DROP INDEX IF EXISTS ${n}`).join(";\n"))
};
