/* Users repository (Phase 3). Services call intent-named methods instead of raw SQL. */
module.exports = (db) => ({
  byId: (id) => db.get("SELECT * FROM users WHERE id=$1", [id]),
  byHandle: (h) => db.get("SELECT * FROM users WHERE LOWER(handle)=LOWER($1)", [h]),
  byPiUid: (uid) => db.get("SELECT * FROM users WHERE pi_uid=$1", [uid]),
  handleTaken: async (h) => !!(await db.get("SELECT 1 x FROM users WHERE LOWER(handle)=LOWER($1)", [h])),
  hasAdmin: async () => !!(await db.get("SELECT 1 x FROM users WHERE role='admin'")),
  setPrefs: (id, prefs) => db.run("UPDATE users SET prefs=$1 WHERE id=$2", [prefs, id])
});
