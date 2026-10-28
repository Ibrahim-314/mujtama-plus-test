/* 084 — v2.123 search stage 1: a real inverted index. Additive only.
 *   search_postings  one row per (form, document, field): field 0 = title, 1 = body, 2 = comments; tf = occurrences
 *   search_vocab     document frequency per form (for idf, typo candidates and typeahead)
 *   search_docs.len  document length in words (BM25 length normalisation)
 * Rows are (re)built by the background upgrade (index version 4); nothing existing is renamed, rewritten or dropped.
 * down() drops only these. */
async function columns(db, table) {
  try {
    if (db.dialect === "postgres") return (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
    return (await db.all(`PRAGMA table_info(${table})`)).map(r => r.name);
  } catch { return []; }
}
module.exports = {
  id: "084_search_postings",
  async up(db, exec) {
    await exec("CREATE TABLE IF NOT EXISTS search_postings (term TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, f INTEGER NOT NULL, tf INTEGER NOT NULL, PRIMARY KEY (term, kind, ref_id, f))");
    await exec("CREATE INDEX IF NOT EXISTS search_postings_doc ON search_postings(kind, ref_id)");
    await exec("CREATE TABLE IF NOT EXISTS search_vocab (term TEXT PRIMARY KEY, df INTEGER NOT NULL DEFAULT 0, len INTEGER NOT NULL DEFAULT 0)");
    await exec("CREATE INDEX IF NOT EXISTS search_vocab_len ON search_vocab(len, df)");
    if (!(await columns(db, "search_docs")).includes("len")) await exec("ALTER TABLE search_docs ADD COLUMN len INTEGER NOT NULL DEFAULT 0");
  },
  async down(db, exec) {
    // the postings go with the table: mark the documents as pre-084 so the background upgrade rebuilds them after a re-up
    try { await db.run("UPDATE search_docs SET iv=3 WHERE iv >= 4"); } catch { /* search_docs without iv: nothing to mark */ }
    await exec("DROP INDEX IF EXISTS search_vocab_len"); await exec("DROP TABLE IF EXISTS search_vocab");
    await exec("DROP INDEX IF EXISTS search_postings_doc"); await exec("DROP TABLE IF EXISTS search_postings");
    if ((await columns(db, "search_docs")).includes("len")) await exec("ALTER TABLE search_docs DROP COLUMN len");
  }
};
