/* 067 — مسار الإرشاد M1-3: the full mentor profile page (M2) needs a few more columns on mentor_profiles + one index.
 * Additive only: four new columns (nullable, or NOT NULL with a DEFAULT) and one new index. Nothing existing is renamed,
 * retyped, dropped or rewritten; no backfill (NULL means "use the defaults below", resolved server-side at read time).
 *   mentor_profiles.visibility   who may open the page: public (everyone, listed in directory / match — today's behaviour,
 *                                so existing mentors keep it) | members (signed-in only) | hidden (only the mentor, their
 *                                mentees + those mentees' active guardians, staff; anyone else gets 404). Enum checked in
 *                                services/mentors.js (no CHECK constraint, so down() stays a plain DROP COLUMN).
 *   mentor_profiles.fields       per-field visibility JSON { field: public | mentees | off }; NULL = FIELD_DEFAULTS.
 *                                Age is opt-in (whole years computed from age_profiles.birth_date, never the date itself).
 *   mentor_profiles.extra        extra profile JSON: approach, skills[], experience[], qualifications[], years, city.
 *   mentor_profiles.reviewed_at  when staff marked the profile reviewed (M5 «ملف مراجَع من الفريق»); NULL = not reviewed.
 *   mentor_feedback_about_rating index (about_user, rating) for the rating aggregates / distribution on every page view.
 * The guarded ALTERs make a re-run a no-op; down() restores the v2.61 schema exactly. */
const VISIBILITY = Object.freeze(["public", "members", "hidden"]);
const VISIBILITY_DEFAULT = "public";
const FIELD_LEVELS = Object.freeze(["public", "mentees", "off"]);
const FIELD_DEFAULTS = Object.freeze({ photo: "public", age: "off", city: "off", experience: "public", qualifications: "public", communities: "off", stats: "public", contact: "public" });

async function columns(db, table) {
  try {
    if (db.dialect === "postgres") return (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1", [table])).map(r => r.name);
    return (await db.all(`PRAGMA table_info(${table})`)).map(r => r.name);
  } catch { return []; }
}
const COLS = [["visibility", `TEXT NOT NULL DEFAULT '${VISIBILITY_DEFAULT}'`], ["fields", "{JSON}"], ["extra", "{JSON}"], ["reviewed_at", "{TS}"]];

module.exports = {
  id: "067_mentor_profile_ext",
  VISIBILITY, VISIBILITY_DEFAULT, FIELD_LEVELS, FIELD_DEFAULTS, COLS,
  async up(db, exec) {
    const have = await columns(db, "mentor_profiles");
    for (const [c, t] of COLS) if (!have.includes(c)) await exec(`ALTER TABLE mentor_profiles ADD COLUMN ${c} ${t}`);
    await exec("CREATE INDEX IF NOT EXISTS mentor_feedback_about_rating ON mentor_feedback(about_user, rating)");
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS mentor_feedback_about_rating");
    const have = await columns(db, "mentor_profiles");
    for (const [c] of [...COLS].reverse()) if (have.includes(c)) await exec(`ALTER TABLE mentor_profiles DROP COLUMN ${c}`);
  }
};
