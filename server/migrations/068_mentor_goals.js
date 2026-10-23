/* 068 — مسار الإرشاد M3-1: shared mentor ↔ mentee goals + a per-session agenda. Additive only: one new table, one new
 * index, one new nullable column. Nothing existing is renamed, retyped, dropped or rewritten; no backfill.
 *   mentor_goals              one goal a mentor and a mentee track together: title (≤ TITLE_MAX chars), status
 *                             todo | doing | done (default todo), an optional due date (TEXT 'YYYY-MM-DD', NULL = none),
 *                             created_at / updated_at. The CHECKs are a backstop; services validate first (friendly errors).
 *   mentor_goals_pair         index (mentor_id, mentee_id) — every read is "goals between this mentor and this mentee".
 *   mentor_sessions.agenda    nullable JSON agenda for one session (items / linked goal ids); NULL = no agenda.
 * The guarded ALTER + IF NOT EXISTS make a re-run a no-op; down() restores the v2.64 schema exactly. */
const STATUS = Object.freeze(["todo", "doing", "done"]);
const STATUS_DEFAULT = "todo";
const TITLE_MAX = 120;

async function columns(db, table) {
  try {
    if (db.dialect === "postgres") return (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
    return (await db.all(`PRAGMA table_info(${table})`)).map(r => r.name);
  } catch { return []; }
}
const SESSION_COLS = [["agenda", "{JSON}"]];

module.exports = {
  id: "068_mentor_goals",
  STATUS, STATUS_DEFAULT, TITLE_MAX, SESSION_COLS,
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mentor_goals (id TEXT PRIMARY KEY, mentor_id TEXT NOT NULL, mentee_id TEXT NOT NULL, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND ${TITLE_MAX}), status TEXT NOT NULL DEFAULT '${STATUS_DEFAULT}' CHECK (status IN (${STATUS.map(s => `'${s}'`).join(", ")})), due_date TEXT, created_at {TS} NOT NULL, updated_at {TS} NOT NULL);
CREATE INDEX IF NOT EXISTS mentor_goals_pair ON mentor_goals(mentor_id, mentee_id);
`);
    const have = await columns(db, "mentor_sessions");
    for (const [c, t] of SESSION_COLS) if (!have.includes(c)) await exec(`ALTER TABLE mentor_sessions ADD COLUMN ${c} ${t}`);
  },
  async down(db, exec) {
    const have = await columns(db, "mentor_sessions");
    for (const [c] of [...SESSION_COLS].reverse()) if (have.includes(c)) await exec(`ALTER TABLE mentor_sessions DROP COLUMN ${c}`);
    await exec("DROP INDEX IF EXISTS mentor_goals_pair");
    await exec("DROP TABLE IF EXISTS mentor_goals");
  }
};
