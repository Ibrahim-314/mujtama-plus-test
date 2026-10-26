/* 082 — 2026-10-27: the game («المدينة الرقمية») was removed from the app on the owner's explicit order, to be rebuilt
 * from scratch later. Drops the two game tables (the saves of 080 and the missions/XP of 081). MJT, the ledger and mining
 * are not touched. down() recreates both tables empty (the v2.103 schema), so a rollback is structurally clean. */
const m080 = require("./080_game_players"), m081 = require("./081_game_missions");
module.exports = {
  id: "082_drop_game",
  async up(db, exec) {
    await exec("DROP INDEX IF EXISTS game_missions_user; DROP TABLE IF EXISTS game_missions; DROP TABLE IF EXISTS game_players");
  },
  async down(db, exec) { await m080.up(db, exec); await m081.up(db, exec); }
};
