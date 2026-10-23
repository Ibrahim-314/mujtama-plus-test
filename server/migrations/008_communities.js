/* 008 — communities (Track 4): channels, join requests, discipline, moderation log & notes, wiki
 * with revisions, resources, advanced events (tickets, waitlist, check-in, recurrence),
 * reminder ledger, job leases, invite links, partners, challenges, daily community metrics. */
module.exports = {
  id: "008_communities",
  async up(db, exec) {
    for (const s of [
      "ALTER TABLE posts ADD COLUMN channel TEXT", "ALTER TABLE posts ADD COLUMN ctag TEXT",
      "ALTER TABLE memberships ADD COLUMN rules_accepted_at {TS}", "ALTER TABLE memberships ADD COLUMN warnings INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE memberships ADD COLUMN muted_until {TS}", "ALTER TABLE memberships ADD COLUMN invited_via TEXT",
      "ALTER TABLE events ADD COLUMN ends_at {TS}", "ALTER TABLE events ADD COLUMN capacity INTEGER", "ALTER TABLE events ADD COLUMN recurrence TEXT",
      "ALTER TABLE events ADD COLUMN series_id TEXT", "ALTER TABLE events ADD COLUMN lat REAL", "ALTER TABLE events ADD COLUMN lng REAL",
      "ALTER TABLE events ADD COLUMN address TEXT", "ALTER TABLE events ADD COLUMN online_url TEXT"
    ]) await exec(s);
    await exec(`
CREATE INDEX IF NOT EXISTS posts_channel ON posts(community, channel, created_at);
CREATE TABLE IF NOT EXISTS community_channels (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL, descr TEXT DEFAULT '', kind TEXT NOT NULL DEFAULT 'text', position INTEGER NOT NULL DEFAULT 0, post_perm TEXT NOT NULL DEFAULT 'members', view_perm TEXT NOT NULL DEFAULT 'members', created_at {TS} NOT NULL, UNIQUE (community, slug));
CREATE TABLE IF NOT EXISTS join_requests (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, answers {JSON}, created_at {TS} NOT NULL, PRIMARY KEY (community, user_id));
CREATE TABLE IF NOT EXISTS mod_notes (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS mod_notes_user ON mod_notes(community, user_id);
CREATE TABLE IF NOT EXISTS mod_actions (id TEXT PRIMARY KEY, community TEXT NOT NULL, actor TEXT NOT NULL, target_user TEXT, target_post TEXT, action TEXT NOT NULL, reason TEXT, meta {JSON}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS mod_actions_c ON mod_actions(community, created_at);
CREATE TABLE IF NOT EXISTS wiki_pages (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, slug TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'page', position INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL, updated_at {TS} NOT NULL, created_at {TS} NOT NULL, UNIQUE (community, slug));
CREATE TABLE IF NOT EXISTS wiki_revisions (id TEXT PRIMARY KEY, page TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE, version INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, author TEXT NOT NULL, summary TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS wiki_rev_page ON wiki_revisions(page, version);
CREATE TABLE IF NOT EXISTS community_resources (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, title TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL, descr TEXT DEFAULT '', added_by TEXT NOT NULL, votes INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS resource_votes (resource TEXT NOT NULL REFERENCES community_resources(id) ON DELETE CASCADE, user_id TEXT NOT NULL, PRIMARY KEY (resource, user_id));
CREATE TABLE IF NOT EXISTS event_tickets (id TEXT PRIMARY KEY, event TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_at {TS} NOT NULL, checked_in_at {TS}, UNIQUE (event, user_id));
CREATE INDEX IF NOT EXISTS event_tickets_ev ON event_tickets(event, status, created_at);
CREATE TABLE IF NOT EXISTS reminder_log (event TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, sent_at {TS} NOT NULL, PRIMARY KEY (event, user_id, kind));
CREATE TABLE IF NOT EXISTS job_leases (name TEXT PRIMARY KEY, holder TEXT NOT NULL, until {TS} NOT NULL, last_run {TS});
CREATE TABLE IF NOT EXISTS community_invites (code TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, created_by TEXT NOT NULL, label TEXT, clicks INTEGER NOT NULL DEFAULT 0, max_uses INTEGER, expires_at {TS}, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS community_partners (a TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, b TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, status TEXT NOT NULL, proposed_by TEXT NOT NULL, created_at {TS} NOT NULL, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS community_challenges (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, title TEXT NOT NULL, descr TEXT DEFAULT '', tag TEXT NOT NULL, prize TEXT, starts_at {TS} NOT NULL, ends_at {TS} NOT NULL, created_by TEXT NOT NULL, winners {JSON}, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS community_metrics (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, day TEXT NOT NULL, posts INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0, reactions INTEGER NOT NULL DEFAULT 0, active_users INTEGER NOT NULL DEFAULT 0, new_members INTEGER NOT NULL DEFAULT 0, left_members INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (community, day));`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS community_metrics; DROP TABLE IF EXISTS community_challenges; DROP TABLE IF EXISTS community_partners; DROP TABLE IF EXISTS community_invites; DROP TABLE IF EXISTS job_leases; DROP TABLE IF EXISTS reminder_log; DROP TABLE IF EXISTS event_tickets; DROP TABLE IF EXISTS resource_votes; DROP TABLE IF EXISTS community_resources; DROP TABLE IF EXISTS wiki_revisions; DROP TABLE IF EXISTS wiki_pages; DROP TABLE IF EXISTS mod_actions; DROP TABLE IF EXISTS mod_notes; DROP TABLE IF EXISTS join_requests; DROP TABLE IF EXISTS community_channels; DROP INDEX IF EXISTS posts_channel`);
    for (const s of ["events DROP COLUMN online_url", "events DROP COLUMN address", "events DROP COLUMN lng", "events DROP COLUMN lat", "events DROP COLUMN series_id", "events DROP COLUMN recurrence", "events DROP COLUMN capacity", "events DROP COLUMN ends_at", "memberships DROP COLUMN invited_via", "memberships DROP COLUMN muted_until", "memberships DROP COLUMN warnings", "memberships DROP COLUMN rules_accepted_at", "posts DROP COLUMN ctag", "posts DROP COLUMN channel"]) await exec("ALTER TABLE " + s);
  }
};
