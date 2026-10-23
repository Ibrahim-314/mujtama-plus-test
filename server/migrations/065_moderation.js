/* 065 — «المجتمع 3.0» stage 4 (v2.59.0): moderation v2 and automod v2. Additive only: new tables and indexes.
 * Nothing existing is renamed, retyped, dropped or rewritten.
 *   mod_claims             who is working on a queue item (claim / assign), expires so nothing stays locked.
 *   community_appeals      a member's appeal against a ban, mute, warning or removed post; decided by a higher rank.
 *   mod_macros             saved moderator replies («قوالب»): action + reason + optional mute hours + message.
 *   mod_prefs              per-moderator notification preferences (digest cadence, instant appeal alerts).
 *   content_fingerprints   duplicate-text fingerprints, written only while a community has the duplicate rule on.
 * comments.status gains the VALUE 'pending' (a comment held by an automod v2 rule); the column is TEXT already, so no
 * schema change — every comment listing filters status='published', so a pending comment is never shown. */
module.exports = {
  id: "065_moderation",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mod_claims (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, item_kind TEXT NOT NULL, item_id TEXT NOT NULL, claimed_by TEXT NOT NULL, assigned_by TEXT, claimed_at {TS} NOT NULL, expires_at {TS} NOT NULL, PRIMARY KEY (community, item_kind, item_id));
CREATE INDEX IF NOT EXISTS mod_claims_by ON mod_claims(community, claimed_by);
CREATE TABLE IF NOT EXISTS community_appeals (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', decided_by TEXT, decided_at {TS}, note TEXT, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS community_appeals_c ON community_appeals(community, status, created_at);
CREATE INDEX IF NOT EXISTS community_appeals_u ON community_appeals(user_id, community);
CREATE UNIQUE INDEX IF NOT EXISTS community_appeals_open ON community_appeals(community, user_id, kind, ref) WHERE status='open';
CREATE TABLE IF NOT EXISTS mod_macros (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, title TEXT NOT NULL, action TEXT NOT NULL, reason TEXT, hours INTEGER, message TEXT, uses INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS});
CREATE INDEX IF NOT EXISTS mod_macros_c ON mod_macros(community, title);
CREATE TABLE IF NOT EXISTS mod_prefs (community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, prefs {JSON}, updated_at {TS} NOT NULL, PRIMARY KEY (community, user_id));
CREATE TABLE IF NOT EXISTS content_fingerprints (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, fp TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'post', created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS content_fingerprints_c ON content_fingerprints(community, user_id, fp, created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP INDEX IF EXISTS content_fingerprints_c; DROP TABLE IF EXISTS content_fingerprints; DROP TABLE IF EXISTS mod_prefs;
DROP INDEX IF EXISTS mod_macros_c; DROP TABLE IF EXISTS mod_macros; DROP INDEX IF EXISTS community_appeals_open; DROP INDEX IF EXISTS community_appeals_u; DROP INDEX IF EXISTS community_appeals_c; DROP TABLE IF EXISTS community_appeals;
DROP INDEX IF EXISTS mod_claims_by; DROP TABLE IF EXISTS mod_claims`);
  }
};
