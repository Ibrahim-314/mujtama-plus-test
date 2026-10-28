/* 083 — v2.121 search v2 («البحث الذكي»). Additive only: three nullable/defaulted columns on search_docs, one index.
 *   extra    normalised tokens of a post's published comments (answers live there), matched at half weight
 *   quality  engagement score log(1 + reactions + 2·comments), a small ranking signal
 *   iv       index version of the row; rows below 2 are re-indexed in the background (no blocking reindex on boot)
 * Nothing existing is renamed, retyped, dropped or rewritten. down() drops only these. */
const COLS = [["extra", "TEXT"], ["quality", "REAL NOT NULL DEFAULT 0"], ["iv", "INTEGER NOT NULL DEFAULT 1"]];
async function columns(db, table) {
  try {
    if (db.dialect === "postgres") return (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
    return (await db.all(`PRAGMA table_info(${table})`)).map(r => r.name);
  } catch { return []; }
}
module.exports = {
  id: "083_search_v2",
  COLS,
  async up(db, exec) {
    const have = await columns(db, "search_docs");
    for (const [c, t] of COLS) if (!have.includes(c)) await exec(`ALTER TABLE search_docs ADD COLUMN ${c} ${t}`);
    await exec("CREATE INDEX IF NOT EXISTS search_docs_iv ON search_docs(kind, iv)");
    if (db.dialect === "postgres") { try { await exec("CREATE INDEX IF NOT EXISTS search_docs_extra_trgm ON search_docs USING gin (extra gin_trgm_ops)"); } catch { /* pg_trgm unavailable: LIKE still works, just slower */ } }
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS search_docs_extra_trgm"); await exec("DROP INDEX IF EXISTS search_docs_iv");
    const have = await columns(db, "search_docs");
    for (const [c] of [...COLS].reverse()) if (have.includes(c)) await exec(`ALTER TABLE search_docs DROP COLUMN ${c}`);
  }
};
