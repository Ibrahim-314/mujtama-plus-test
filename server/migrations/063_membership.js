/* 063 — «المجتمع 3.0» stage 2 (v2.57.0): membership, requests, invites, ownership transfer. Additive only: new columns
 * (every NOT NULL one has a DEFAULT), new tables, new indexes. Nothing existing is renamed, retyped, dropped or rewritten;
 * the one backfill (community_invites.uses from the current membership count) runs at runtime and is idempotent.
 *   join_requests.status / decided_by / decided_at / reason / source
 *       a request is no longer deleted when decided: pending → approved | rejected | cancelled stays as history
 *       (who decided, when, why; source = direct | invite | link).
 *   community_invites.revoked_at / grant_role / skip_approval / uses / note
 *       revoke a link, a role granted on join (member | moderator), skip the approval of a private community,
 *       a uses counter (the reservation stays the row-locked COUNT of memberships.invited_via), a private note.
 *   community_member_invites   a direct invitation of one person (invite-only communities read this first, then the
 *                              legacy `kind='invite'` notification, so nobody invited before v2.57 loses access).
 *   community_transfers        ownership transfer: requested by the owner, accepted by the recipient within 72 h. */
module.exports = {
  id: "063_membership",
  async up(db, exec) {
    for (const s of [
      "ALTER TABLE join_requests ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
      "ALTER TABLE join_requests ADD COLUMN decided_by TEXT",
      "ALTER TABLE join_requests ADD COLUMN decided_at {TS}",
      "ALTER TABLE join_requests ADD COLUMN reason TEXT",
      "ALTER TABLE join_requests ADD COLUMN source TEXT",
      "ALTER TABLE community_invites ADD COLUMN revoked_at {TS}",
      "ALTER TABLE community_invites ADD COLUMN grant_role TEXT",
      "ALTER TABLE community_invites ADD COLUMN skip_approval INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE community_invites ADD COLUMN uses INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE community_invites ADD COLUMN note TEXT"
    ]) await exec(s);
    await exec(`
CREATE TABLE IF NOT EXISTS community_member_invites (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL, invited_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at {TS} NOT NULL, responded_at {TS});
CREATE INDEX IF NOT EXISTS community_member_invites_c ON community_member_invites(community, status, created_at);
CREATE INDEX IF NOT EXISTS community_member_invites_u ON community_member_invites(user_id, status);
CREATE TABLE IF NOT EXISTS community_transfers (id TEXT PRIMARY KEY, community TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, from_user TEXT NOT NULL, to_user TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at {TS} NOT NULL, expires_at {TS} NOT NULL, decided_at {TS});
CREATE INDEX IF NOT EXISTS community_transfers_c ON community_transfers(community, status);
CREATE INDEX IF NOT EXISTS community_transfers_to ON community_transfers(to_user, status);
CREATE INDEX IF NOT EXISTS join_requests_status ON join_requests(community, status, created_at)`);
  },
  async down(db, exec) {
    await exec(`DROP INDEX IF EXISTS join_requests_status; DROP INDEX IF EXISTS community_transfers_to; DROP INDEX IF EXISTS community_transfers_c; DROP INDEX IF EXISTS community_member_invites_u; DROP INDEX IF EXISTS community_member_invites_c;
DROP TABLE IF EXISTS community_transfers; DROP TABLE IF EXISTS community_member_invites`);
    for (const s of ["community_invites DROP COLUMN note", "community_invites DROP COLUMN uses", "community_invites DROP COLUMN skip_approval", "community_invites DROP COLUMN grant_role", "community_invites DROP COLUMN revoked_at",
      "join_requests DROP COLUMN source", "join_requests DROP COLUMN reason", "join_requests DROP COLUMN decided_at", "join_requests DROP COLUMN decided_by", "join_requests DROP COLUMN status"]) await exec("ALTER TABLE " + s);
  }
};
