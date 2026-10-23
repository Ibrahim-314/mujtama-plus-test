/* 059 — Teams & group projects «الفرق والمشاريع» (phase 79). Additive only: six new tables (prefix wt_ — the phase 6
 * organisations already own `team_activity`).
 * wt_teams     a team or a project: name, about, kind team | project, visibility private | listed (a public directory where
 *              members may ask to join), status active | completed | archived, optional linked contract (phase 78).
 * wt_members   membership with a role (owner | admin | member | viewer) and a free job title («مصمّم»).
 * wt_invites   direct invites (to a member), invite links (code, expiry, use cap) and join requests (from a member).
 * wt_tasks     the task board: todo | doing | review | done, assignee, due date, priority, order, optional contract milestone.
 * wt_items     files & links: a link (http/https) or an uploaded image (media id), with a note.
 * wt_updates   updates and discussion: top-level posts (update | question) and replies. */
module.exports = {
  id: "059_teams",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS wt_teams (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'project', name TEXT NOT NULL, about TEXT, visibility TEXT NOT NULL DEFAULT 'private', status TEXT NOT NULL DEFAULT 'active', contract_id TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, closed_at {TS});
CREATE INDEX IF NOT EXISTS wt_teams_owner ON wt_teams(owner_id);
CREATE INDEX IF NOT EXISTS wt_teams_listed ON wt_teams(visibility, status, updated_at);
CREATE INDEX IF NOT EXISTS wt_teams_contract ON wt_teams(contract_id);
CREATE TABLE IF NOT EXISTS wt_members (team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', title TEXT, joined_at {TS} NOT NULL, PRIMARY KEY (team_id, user_id));
CREATE INDEX IF NOT EXISTS wt_members_user ON wt_members(user_id);
CREATE TABLE IF NOT EXISTS wt_invites (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'invite', by_user TEXT NOT NULL, user_id TEXT, code TEXT, role TEXT NOT NULL DEFAULT 'member', note TEXT, status TEXT NOT NULL DEFAULT 'pending', uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER, expires_at {TS}, created_at {TS} NOT NULL, decided_at {TS});
CREATE INDEX IF NOT EXISTS wt_invites_team ON wt_invites(team_id, status);
CREATE INDEX IF NOT EXISTS wt_invites_user ON wt_invites(user_id, status);
CREATE INDEX IF NOT EXISTS wt_invites_code ON wt_invites(code);
CREATE TABLE IF NOT EXISTS wt_tasks (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'todo', assignee_id TEXT, due TEXT, priority TEXT NOT NULL DEFAULT 'normal', pos INTEGER NOT NULL DEFAULT 0, milestone_id TEXT, created_by TEXT NOT NULL, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, done_at {TS});
CREATE INDEX IF NOT EXISTS wt_tasks_team ON wt_tasks(team_id, status, pos);
CREATE INDEX IF NOT EXISTS wt_tasks_assignee ON wt_tasks(assignee_id, status);
CREATE TABLE IF NOT EXISTS wt_items (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'link', title TEXT NOT NULL, url TEXT, media_id TEXT, note TEXT, by_user TEXT NOT NULL, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS wt_items_team ON wt_items(team_id, created_at);
CREATE TABLE IF NOT EXISTS wt_updates (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'update', parent_id TEXT, body TEXT NOT NULL, warn INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS wt_updates_team ON wt_updates(team_id, created_at);
CREATE INDEX IF NOT EXISTS wt_updates_parent ON wt_updates(parent_id)`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS wt_updates; DROP TABLE IF EXISTS wt_items; DROP TABLE IF EXISTS wt_tasks; DROP TABLE IF EXISTS wt_invites; DROP TABLE IF EXISTS wt_members; DROP TABLE IF EXISTS wt_teams`);
  }
};
