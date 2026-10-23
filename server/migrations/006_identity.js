/* 006 — identity (Track 2): rich profiles, verification & reputation, fine-grained privacy,
 * organisations & delegation, onboarding/retention & experiments. */
const USER_COLS = [["avatar", "TEXT"], ["cover", "TEXT"], ["avatar_hash", "TEXT"], ["location", "TEXT"], ["country", "TEXT"], ["links", "{JSON}"], ["expertise", "{JSON}"], ["pinned_posts", "{JSON}"],
  ["sections", "{JSON}"], ["verified", "TEXT"], ["reputation", "INTEGER NOT NULL DEFAULT 0"], ["account_type", "TEXT NOT NULL DEFAULT 'person'"], ["private", "INTEGER NOT NULL DEFAULT 0"], ["privacy", "{JSON}"]];
module.exports = {
  id: "006_identity",
  async up(db, exec) {
    await exec(USER_COLS.map(([c, t]) => `ALTER TABLE users ADD COLUMN ${c} ${t}`).join(";\n"));
    await exec(`ALTER TABLE conversation_members ADD COLUMN state TEXT NOT NULL DEFAULT 'accepted'`);
    await exec(`
CREATE TABLE IF NOT EXISTS follow_requests (src TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, dst TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at {TS} NOT NULL, PRIMARY KEY (src, dst));
CREATE INDEX IF NOT EXISTS follow_requests_dst ON follow_requests(dst, at);
CREATE TABLE IF NOT EXISTS close_friends (owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, member TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at {TS} NOT NULL, PRIMARY KEY (owner, member));
CREATE TABLE IF NOT EXISTS verification_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, note TEXT, docs {JSON}, status TEXT NOT NULL DEFAULT 'pending', reason TEXT, reviewer TEXT, decided_at {TS}, created_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS verification_status ON verification_requests(status, created_at);
CREATE TABLE IF NOT EXISTS achievements (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS user_reputation (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, score INTEGER NOT NULL, breakdown {JSON}, computed_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS impersonation_flags (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, similar_to TEXT NOT NULL, reason TEXT NOT NULL, score REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS org_members (org TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, added_at {TS} NOT NULL, PRIMARY KEY (org, user_id));
CREATE INDEX IF NOT EXISTS org_members_user ON org_members(user_id);
CREATE TABLE IF NOT EXISTS org_invites (id TEXT PRIMARY KEY, org TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, by_user TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS team_activity (id {SERIAL}, org TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS team_activity_org ON team_activity(org, at);
CREATE TABLE IF NOT EXISTS onboarding (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, tour_done INTEGER NOT NULL DEFAULT 0, celebrated {JSON}, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS experiments (key TEXT PRIMARY KEY, description TEXT, variants {JSON} NOT NULL, goal TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at {TS} NOT NULL);
CREATE TABLE IF NOT EXISTS experiment_exposures (key TEXT NOT NULL, user_id TEXT NOT NULL, variant TEXT NOT NULL, at {TS} NOT NULL, PRIMARY KEY (key, user_id))`);
  },
  async down(db, exec) {
    await exec(`DROP TABLE IF EXISTS experiment_exposures; DROP TABLE IF EXISTS experiments; DROP TABLE IF EXISTS onboarding; DROP TABLE IF EXISTS team_activity; DROP TABLE IF EXISTS org_invites; DROP TABLE IF EXISTS org_members;
DROP TABLE IF EXISTS impersonation_flags; DROP TABLE IF EXISTS user_reputation; DROP TABLE IF EXISTS achievements; DROP TABLE IF EXISTS verification_requests; DROP TABLE IF EXISTS close_friends; DROP TABLE IF EXISTS follow_requests`);
    await exec(`ALTER TABLE conversation_members DROP COLUMN state`);
    await exec(USER_COLS.map(([c]) => `ALTER TABLE users DROP COLUMN ${c}`).join(";\n"));
  }
};
