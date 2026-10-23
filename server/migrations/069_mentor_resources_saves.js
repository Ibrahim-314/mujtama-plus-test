/* 069 — مسار الإرشاد M4-1: a mentor's resource library (F8) + learners saving a mentor with an optional slot notice (F9).
 * Additive only: two new tables, two new indexes. Nothing existing is renamed, retyped, dropped or rewritten; no backfill.
 *   mentor_resources          one item in a mentor's library: title (1…TITLE_MAX chars), kind link | file | note,
 *                             url (https:// only, ≤ URL_MAX; NULL allowed only for kind note), note (≤ NOTE_MAX, nullable),
 *                             visibility mentees | public (default mentees), sort (int, default 0), created_at / updated_at.
 *   mentor_resources_mentor   index (mentor_id, sort) — every read is "this mentor's library, in order".
 *   mentor_saves              a user saved a mentor: one row per (user_id, mentor_id) (composite PK), notify_slots
 *                             0/1 (INTEGER like every other flag here, default 1 = notify), last_notified_at for the
 *                             daily debounce (NULL = never notified), created_at.
 *   mentor_saves_mentor       index (mentor_id) — "who saved this mentor" when the mentor adds new slots.
 * The CHECKs are a backstop; services validate first (friendly errors). IF NOT EXISTS makes a re-run a no-op;
 * down() restores the v2.65 schema exactly (drops only what this file created). */
const KINDS = Object.freeze(["link", "file", "note"]);
const VISIBILITY = Object.freeze(["mentees", "public"]);
const VISIBILITY_DEFAULT = "mentees";
const TITLE_MAX = 120;
const URL_MAX = 500;
const NOTE_MAX = 500;
const URL_PREFIX = "https://";
const RESOURCES_MAX = 30; // per mentor (PLAN F8) — enforced by the service, not the schema
const list = a => a.map(s => `'${s}'`).join(", ");

module.exports = {
  id: "069_mentor_resources_saves",
  KINDS, VISIBILITY, VISIBILITY_DEFAULT, TITLE_MAX, URL_MAX, NOTE_MAX, URL_PREFIX, RESOURCES_MAX,
  async up(db, exec) {
    await exec(`
CREATE TABLE IF NOT EXISTS mentor_resources (id TEXT PRIMARY KEY, mentor_id TEXT NOT NULL, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND ${TITLE_MAX}), url TEXT CHECK (url IS NULL OR (substr(url, 1, ${URL_PREFIX.length}) = '${URL_PREFIX}' AND length(url) BETWEEN ${URL_PREFIX.length + 1} AND ${URL_MAX})), kind TEXT NOT NULL CHECK (kind IN (${list(KINDS)})), note TEXT CHECK (note IS NULL OR length(note) <= ${NOTE_MAX}), visibility TEXT NOT NULL DEFAULT '${VISIBILITY_DEFAULT}' CHECK (visibility IN (${list(VISIBILITY)})), sort INTEGER NOT NULL DEFAULT 0, created_at {TS} NOT NULL, updated_at {TS} NOT NULL, CHECK (kind = 'note' OR url IS NOT NULL));
CREATE INDEX IF NOT EXISTS mentor_resources_mentor ON mentor_resources(mentor_id, sort);
CREATE TABLE IF NOT EXISTS mentor_saves (user_id TEXT NOT NULL, mentor_id TEXT NOT NULL, created_at {TS} NOT NULL, notify_slots INTEGER NOT NULL DEFAULT 1 CHECK (notify_slots IN (0, 1)), last_notified_at {TS}, PRIMARY KEY (user_id, mentor_id));
CREATE INDEX IF NOT EXISTS mentor_saves_mentor ON mentor_saves(mentor_id);
`);
  },
  async down(db, exec) {
    await exec("DROP INDEX IF EXISTS mentor_saves_mentor");
    await exec("DROP TABLE IF EXISTS mentor_saves");
    await exec("DROP INDEX IF EXISTS mentor_resources_mentor");
    await exec("DROP TABLE IF EXISTS mentor_resources");
  }
};
