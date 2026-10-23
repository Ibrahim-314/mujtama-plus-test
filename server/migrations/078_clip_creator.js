/* 078 — v2.80 «أدوات صانع فيديوتك»: Vidtik drafts + per-clip stats.
 * Additive only: one new table, two nullable columns, one index. Nothing existing is renamed, retyped, dropped or rewritten;
 * no backfill (old watch rows simply have no source / first time and count as "other" in the source breakdown).
 *   clip_drafts           a clip saved half-way from the Vidtik editor: the uploaded video (media_id, owned by user_id),
 *                         caption, cover position (cover_pos 0..1000 on the editor's slider), link {kind,id} JSON, an
 *                         optional publish_at the creator picked, created_at / updated_at. At most 20 per member (service).
 *   clip_watch.src        where the viewer met the clip: foryou | following | profile | tag | sound | challenge | link | other
 *                         (whitelisted in services/clipstudio.js). Written on the FIRST watch only; later visits keep it.
 *   clip_watch.first_at   when that viewer first watched (views-per-day chart). NULL on rows older than v2.80.
 *   clip_watch_post_first index (post_id, first_at) for the per-clip daily chart.
 * Guarded ALTERs + IF NOT EXISTS make a re-run a no-op; down() restores the v2.79 schema exactly. */
async function columns(db, table) {
  try {
    if (db.dialect === "postgres") return (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
    return (await db.all(`PRAGMA table_info(${table})`)).map(r => r.name);
  } catch { return []; }
}
const COLS = [["src", "TEXT"], ["first_at", "{TS}"]];

module.exports = {
  id: "078_clip_creator",
  COLS,
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS clip_drafts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, media_id TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', cover_pos INTEGER, link {JSON}, publish_at {TS}, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS clip_drafts_user ON clip_drafts(user_id, updated_at);
`);
    const have = await columns(db, "clip_watch");
    for (const [c, t] of COLS) if (!have.includes(c)) await exec(`ALTER TABLE clip_watch ADD COLUMN ${c} ${t}`);
    await exec("CREATE INDEX IF NOT EXISTS clip_watch_post_first ON clip_watch(post_id, first_at)");
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS clip_watch_post_first");
    const have = await columns(db, "clip_watch");
    for (const [c] of [...COLS].reverse()) if (have.includes(c)) await exec(`ALTER TABLE clip_watch DROP COLUMN ${c}`);
    await exec("DROP INDEX IF EXISTS clip_drafts_user");
    await exec("DROP TABLE IF EXISTS clip_drafts");
  }
};
