/* 085 — v2.124 search: a sound key per indexed word (lib/search-phonetic.js) so «بايثون» finds «python» for any loanword.
 * Additive: one nullable column + one index on search_vocab; the background upgrade fills it in batches. down() drops only these. */
async function columns(db, table) {
  try {
    if (db.dialect === "postgres") return (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
    return (await db.all(`PRAGMA table_info(${table})`)).map(r => r.name);
  } catch { return []; }
}
module.exports = {
  id: "085_search_soundkey",
  async up(db, exec) {
    if (!(await columns(db, "search_vocab")).includes("pk")) await exec("ALTER TABLE search_vocab ADD COLUMN pk TEXT");
    await exec("CREATE INDEX IF NOT EXISTS search_vocab_pk ON search_vocab(pk)");
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS search_vocab_pk");
    if ((await columns(db, "search_vocab")).includes("pk")) await exec("ALTER TABLE search_vocab DROP COLUMN pk");
  }
};
