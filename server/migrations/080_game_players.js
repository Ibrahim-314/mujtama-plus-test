/* 080 — v2.88 «المدينة الرقمية» (the game): one save per member.
 * Additive only: one new table. Nothing existing is renamed, retyped, dropped or rewritten.
 *   game_players   the member's game save: the character they picked, the name they play under, where they are in the
 *                  story (chapter, scene, position), level/xp, story flags (JSON object) and their game settings (JSON).
 * IF NOT EXISTS makes a re-run a no-op; down() restores the v2.87 schema exactly. */
module.exports = {
  id: "080_game_players",
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS game_players (user_id TEXT PRIMARY KEY, char TEXT NOT NULL, name TEXT NOT NULL, chapter INTEGER NOT NULL DEFAULT 0, scene TEXT NOT NULL DEFAULT 'room', pos TEXT, level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0, flags TEXT NOT NULL DEFAULT '{}', settings TEXT NOT NULL DEFAULT '{}', created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
`);
  },
  async down(db, exec) {
    await exec("DROP TABLE IF EXISTS game_players");
  }
};
