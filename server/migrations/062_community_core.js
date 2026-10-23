/* 062 — «المجتمع 3.0» stage 1 (v2.56.0): the safe foundation. Additive only: new tables, new columns, new indexes.
 * Nothing existing is renamed, retyped, dropped or rewritten here; every backfill happens at runtime and is idempotent.
 *   community_roles         custom roles per community (name, color, icon, position, perms JSON). The four base roles stay in
 *                           memberships.role (unchanged meaning); custom roles only ADD permissions (lib/cperm.js).
 *   member_roles            extra roles granted to a member (granted_by, granted_at).
 *   memberships.status      active | muted | banned | pending — status kept apart from the role.
 *   memberships.prev_role   the role a member held before a mute/ban; restored when the sanction is lifted.
 *   community_sanctions     warn | mute | ban history with until / lifted_at / lifted_by.
 *   mod_actions.category / diff / ip_hash   one audit log: category (moderation/settings/members/roles/channels/…), before→after.
 *   community_member_stats  per-member counters (posts, reactions received, score) → page open reads a top-N index, no scan.
 *   communities.member_count / posts_14d / last_activity_at / archived_at / slug   cached counters (reconciled by a job).
 *   community_member_events join | leave | ban | approve | reject | role — feeds growth & left_members later.
 *   indexes                 memberships, mod_actions, reports, events, posts, challenges (plan §1.7). */
module.exports = {
  id: "062_community_core",
  async up(db, exec) {
    for (const s of [
      "ALTER TABLE memberships ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
      "ALTER TABLE memberships ADD COLUMN prev_role TEXT",
      "ALTER TABLE mod_actions ADD COLUMN category TEXT",
      "ALTER TABLE mod_actions ADD COLUMN diff {JSON}",
      "ALTER TABLE mod_actions ADD COLUMN ip_hash TEXT",
      "ALTER TABLE communities ADD COLUMN member_count INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE communities ADD COLUMN posts_14d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE communities ADD COLUMN last_activity_at {TS}",
      "ALTER TABLE communities ADD COLUMN archived_at {TS}",
      "ALTER TABLE communities ADD COLUMN slug TEXT"
    ]) await exec(s);
    await exec(`
CREATE TABLE IF NOT EXISTS community_roles (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT, icon TEXT, position INTEGER NOT NULL DEFAULT 0, perms {JSON}, is_system INTEGER NOT NULL DEFAULT 0, mentionable INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS community_roles_c ON community_roles(community, position);
CREATE TABLE IF NOT EXISTS member_roles (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, role_id TEXT NOT NULL REFERENCES community_roles(id) ON DELETE CASCADE, granted_by TEXT, granted_at {TS} NOT NULL, PRIMARY KEY (community, user_id, role_id));
CREATE INDEX IF NOT EXISTS member_roles_role ON member_roles(role_id);
CREATE TABLE IF NOT EXISTS community_sanctions (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, kind TEXT NOT NULL, until {TS}, reason TEXT, rule_id TEXT, actor TEXT NOT NULL, created_at {TS} NOT NULL, lifted_at {TS}, lifted_by TEXT);
CREATE INDEX IF NOT EXISTS community_sanctions_u ON community_sanctions(community, user_id, created_at);
CREATE TABLE IF NOT EXISTS community_member_stats (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, posts INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0, reactions_received INTEGER NOT NULL DEFAULT 0, answers_accepted INTEGER NOT NULL DEFAULT 0, last_active_at {TS}, score INTEGER NOT NULL DEFAULT 0, updated_at {TS}, PRIMARY KEY (community, user_id));
CREATE INDEX IF NOT EXISTS community_member_stats_score ON community_member_stats(community, score);
CREATE TABLE IF NOT EXISTS community_member_events (id {SERIAL}, community TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, at {TS} NOT NULL, meta {JSON});
CREATE INDEX IF NOT EXISTS community_member_events_c ON community_member_events(community, at);
CREATE UNIQUE INDEX IF NOT EXISTS communities_slug ON communities(slug);
CREATE INDEX IF NOT EXISTS memberships_c_role ON memberships(community, role, joined_at);
CREATE INDEX IF NOT EXISTS memberships_invited ON memberships(invited_via);
CREATE INDEX IF NOT EXISTS mod_actions_target ON mod_actions(community, target_user, created_at);
CREATE INDEX IF NOT EXISTS reports_target_status ON reports(target, status);
CREATE INDEX IF NOT EXISTS events_c_status ON events(community, status, starts_at);
CREATE INDEX IF NOT EXISTS posts_c_status ON posts(community, status, created_at, id);
CREATE INDEX IF NOT EXISTS community_challenges_c ON community_challenges(community, ends_at)`);
  },
  async down(db, exec) {
    await exec(`DROP INDEX IF EXISTS community_challenges_c; DROP INDEX IF EXISTS posts_c_status; DROP INDEX IF EXISTS events_c_status; DROP INDEX IF EXISTS reports_target_status; DROP INDEX IF EXISTS mod_actions_target; DROP INDEX IF EXISTS memberships_invited; DROP INDEX IF EXISTS memberships_c_role; DROP INDEX IF EXISTS communities_slug;
DROP TABLE IF EXISTS community_member_events; DROP TABLE IF EXISTS community_member_stats; DROP TABLE IF EXISTS community_sanctions; DROP TABLE IF EXISTS member_roles; DROP TABLE IF EXISTS community_roles`);
    for (const s of ["communities DROP COLUMN slug", "communities DROP COLUMN archived_at", "communities DROP COLUMN last_activity_at", "communities DROP COLUMN posts_14d", "communities DROP COLUMN member_count",
      "mod_actions DROP COLUMN ip_hash", "mod_actions DROP COLUMN diff", "mod_actions DROP COLUMN category", "memberships DROP COLUMN prev_role", "memberships DROP COLUMN status"]) await exec("ALTER TABLE " + s);
  }
};
