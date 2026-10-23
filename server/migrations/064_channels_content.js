/* 064 — «المجتمع 3.0» stage 3 (v2.58.0): channels, content, rules and welcome. Additive only: new tables, new columns
 * (every NOT NULL one has a DEFAULT), new indexes. Nothing existing is renamed, retyped, dropped or rewritten; the one
 * backfill (community_rules from communities.rules) runs at runtime and is idempotent (services/cchannels.js).
 *   community_channel_groups   channel categories (name, position, collapsed by default) + community_channels.group_id.
 *   community_channels.*       icon, archived_at (archive instead of delete), slow_mode_sec, require_approval,
 *                              allowed_types JSON, view_roles JSON / post_roles JSON (base roles or custom role ids),
 *                              topic_required, pinned_post, is_default (the channel newcomers land in).
 *   channel_reads              last time a member opened a channel → the light "unread" count.
 *   community_pins             up to 5 per community and 3 per channel, optional expiry.
 *   community_announcements    the bar above the identity card (info | important, schedule, dismissible) +
 *   announcement_dismissals    who closed which announcement.
 *   community_rules            structured rules (title, body, severity, order). communities.rules stays the mirror (titles).
 *   community_onboarding       welcome steps done per member, on the server (replaces localStorage; imported once).
 *   wiki_pages.section         a section/category for knowledge-base pages. */
module.exports = {
  id: "064_channels_content",
  async up(db, exec) {
    for (const s of [
      "ALTER TABLE community_channels ADD COLUMN group_id TEXT",
      "ALTER TABLE community_channels ADD COLUMN icon TEXT",
      "ALTER TABLE community_channels ADD COLUMN archived_at {TS}",
      "ALTER TABLE community_channels ADD COLUMN slow_mode_sec INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE community_channels ADD COLUMN require_approval INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE community_channels ADD COLUMN allowed_types {JSON}",
      "ALTER TABLE community_channels ADD COLUMN view_roles {JSON}",
      "ALTER TABLE community_channels ADD COLUMN post_roles {JSON}",
      "ALTER TABLE community_channels ADD COLUMN topic_required INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE community_channels ADD COLUMN pinned_post TEXT",
      "ALTER TABLE community_channels ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE wiki_pages ADD COLUMN section TEXT"
    ]) await exec(s);
    await exec(`
CREATE TABLE IF NOT EXISTS community_channel_groups (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, collapsed_default INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS community_channel_groups_c ON community_channel_groups(community, position);
CREATE TABLE IF NOT EXISTS channel_reads (community TEXT NOT NULL, channel TEXT NOT NULL, user_id TEXT NOT NULL, last_seen_at {TS} NOT NULL, PRIMARY KEY (channel, user_id));
CREATE INDEX IF NOT EXISTS channel_reads_u ON channel_reads(user_id, community);
CREATE TABLE IF NOT EXISTS community_pins (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, channel TEXT, post TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, pinned_by TEXT NOT NULL, until {TS}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS community_pins_c ON community_pins(community, channel, position);
CREATE UNIQUE INDEX IF NOT EXISTS community_pins_post ON community_pins(community, post);
CREATE TABLE IF NOT EXISTS community_announcements (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT, level TEXT NOT NULL DEFAULT 'info', starts_at {TS} NOT NULL, ends_at {TS}, dismissible INTEGER NOT NULL DEFAULT 1, notified INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS community_announcements_c ON community_announcements(community, starts_at);
CREATE TABLE IF NOT EXISTS announcement_dismissals (announcement TEXT NOT NULL REFERENCES community_announcements(id) ON DELETE CASCADE, user_id TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (announcement, user_id));
CREATE TABLE IF NOT EXISTS community_rules (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, body TEXT, severity TEXT NOT NULL DEFAULT 'info', created_at {TS} NOT NULL, updated_at {TS});
CREATE INDEX IF NOT EXISTS community_rules_c ON community_rules(community, position);
CREATE TABLE IF NOT EXISTS community_onboarding (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, step INTEGER NOT NULL, done_at {TS} NOT NULL, PRIMARY KEY (community, user_id, step));
CREATE INDEX IF NOT EXISTS community_channels_group ON community_channels(community, group_id, position);
CREATE INDEX IF NOT EXISTS posts_c_channel ON posts(community, channel, created_at);
CREATE INDEX IF NOT EXISTS wiki_pages_section ON wiki_pages(community, section)`);
  },
  async down(db, exec) {
    await exec(`DROP INDEX IF EXISTS wiki_pages_section; DROP INDEX IF EXISTS posts_c_channel; DROP INDEX IF EXISTS community_channels_group;
DROP TABLE IF EXISTS community_onboarding; DROP TABLE IF EXISTS community_rules; DROP TABLE IF EXISTS announcement_dismissals; DROP TABLE IF EXISTS community_announcements; DROP TABLE IF EXISTS community_pins; DROP TABLE IF EXISTS channel_reads; DROP TABLE IF EXISTS community_channel_groups`);
    for (const s of ["wiki_pages DROP COLUMN section", "community_channels DROP COLUMN is_default", "community_channels DROP COLUMN pinned_post", "community_channels DROP COLUMN topic_required", "community_channels DROP COLUMN post_roles", "community_channels DROP COLUMN view_roles",
      "community_channels DROP COLUMN allowed_types", "community_channels DROP COLUMN require_approval", "community_channels DROP COLUMN slow_mode_sec", "community_channels DROP COLUMN archived_at", "community_channels DROP COLUMN icon", "community_channels DROP COLUMN group_id"]) await exec("ALTER TABLE " + s);
  }
};
