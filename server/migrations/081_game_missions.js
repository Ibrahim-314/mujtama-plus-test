/* 081 — Phase 2D-A: the game's completed missions (server-authoritative XP). One new table and one index.
 * Additive only: nothing existing is renamed, retyped, dropped or rewritten; game_players keeps its columns and rows.
 *   game_missions   one row per member per completed mission. PRIMARY KEY (user_id, mission_id) makes a second completion
 *                   of the same mission impossible at the database level (a replayed or concurrent request inserts
 *                   nothing and therefore grants no XP). xp = the XP the server's catalogue gave at the time;
 *                   verify = "story" (story-flow check) | "server" (backed by a server record). No money column: Phase A
 *                   awards in-game XP only.
 * IF NOT EXISTS makes a re-run a no-op; down() drops only this table (and its index), restoring the v2.98 schema. */
module.exports = {
  id: "081_game_missions",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS game_missions (user_id TEXT NOT NULL, mission_id TEXT NOT NULL, xp INTEGER NOT NULL, verify TEXT NOT NULL, completed_at {TS} NOT NULL, PRIMARY KEY (user_id, mission_id));
CREATE INDEX IF NOT EXISTS game_missions_user ON game_missions(user_id, completed_at);
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS game_missions_user; DROP TABLE IF EXISTS game_missions");
  }
};
